"use client";

import { useCallback, useRef, useState } from "react";

type Task = () => Promise<void>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type MessagePayload = {
  body: string;
  ingestKey: string;
  lang?: string;
  speakerName?: string;
};

const RETRY_DELAYS_MS = [0, 750, 2_000] as const;
const REQUEST_TIMEOUT_MS = 20_000;

export function retryAfterMilliseconds(response: Response): number {
  const raw = response.headers.get("retry-after");
  if (!raw) return 0;
  const value = /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function queueAfter(previous: Promise<void>, task: Task): Promise<void> {
  return previous.then(task, task);
}

/** 저장 여부를 알 수 없는 끊김도 같은 키로 재시도해 원문 중복을 막는다. */
export async function postPageMessage(
  token: string,
  payload: MessagePayload,
  options: {
    fetcher?: Fetcher;
    delays?: readonly number[];
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const delays = options.delays ?? RETRY_DELAYS_MS;
  let lastError: unknown;
  let retryAfter = 0;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const delay = Math.max(delays[attempt], retryAfter);
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(`/api/pages/${encodeURIComponent(token)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (
        response.ok ||
        (![408, 425, 429].includes(response.status) && response.status < 500) ||
        attempt === delays.length - 1
      ) {
        return response;
      }
      retryAfter = retryAfterMilliseconds(response);
      // Leave long cooldowns to the recoverable outbox instead of hiding them in a pending request.
      if (retryAfter > 30000) return response;
      void response.body?.cancel();
    } catch (cause) {
      lastError = cause;
      if (attempt === delays.length - 1) throw cause;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("메시지 전송에 실패했습니다");
}

/** 입력은 즉시 비우되 HTTP 전송 순서는 보존한다. */
export function useSubmitQueue() {
  const tail = useRef(Promise.resolve());
  const pending = useRef(0);
  const [sending, setSending] = useState(false);

  const enqueue = useCallback((task: Task) => {
    pending.current += 1;
    setSending(true);

    const result = queueAfter(tail.current, task);
    const done = () => {
      pending.current -= 1;
      if (pending.current === 0) setSending(false);
    };
    tail.current = result.then(done, done);
  }, []);

  return { enqueue, sending };
}
