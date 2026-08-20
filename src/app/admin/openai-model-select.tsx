"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { parseJsonResponse } from "@/lib/json-response";

const modelsResponseSchema = z.object({ models: z.array(z.string()).optional() });
const modelResponseSchema = z.object({
  model: z.string().nullable().optional(),
  error: z.string().optional(),
});

function withCurrent(models: readonly string[], current: string): string[] {
  return [...new Set([current, ...models].filter(Boolean))];
}

function sameModels(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

/** 계정에서 실제로 쓸 수 있는 OpenAI 언어모델을 고른다. */
export function OpenaiModelSelect({
  label,
  initial,
  initialModels,
  hidden,
  onError,
  onPendingChange,
}: {
  label: string;
  initial: string;
  /** 서버 DB 캐시. 최신 목록을 받기 전부터 바로 보여 준다. */
  initialModels: string[];
  /** 감춰져 있어도 마운트되어 관리 페이지 진입 때 모델 목록을 갱신한다. */
  hidden: boolean;
  onError: (message: string | null) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [models, setModels] = useState(() => withCurrent(initialModels, initial));
  const saved = useRef(initial);

  useEffect(() => {
    let active = true;

    void fetch("/api/admin/openai-models", { cache: "no-store" })
      .then((response) => parseJsonResponse(response, modelsResponseSchema))
      .then((payload) => {
        if (!active) return;
        const fresh = withCurrent(payload?.models ?? [], saved.current);
        setModels((cached) => (sameModels(cached, fresh) ? cached : fresh));
      })
      .catch(() => {
        // 조회 실패 시 이미 화면에 있는 DB 캐시를 그대로 쓴다.
      });

    return () => {
      active = false;
    };
  }, []);

  const save = async (next: string) => {
    if (next === saved.current) return;

    onPendingChange?.(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/engine-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engine: "openai", model: next }),
      });
      const payload = await parseJsonResponse(response, modelResponseSchema);

      if (!response.ok || !payload?.model) {
        setValue(saved.current);
        onError(payload?.error ?? null);
        return;
      }

      saved.current = payload.model;
      setValue(payload.model);
    } catch (error) {
      setValue(saved.current);
      onError(error instanceof Error ? error.message : null);
    } finally {
      onPendingChange?.(false);
    }
  };

  if (hidden) return null;

  return (
    <>
      <label htmlFor="openai-model" className="font-mono text-[11px] text-muted">
        {label}
      </label>
      <select
        id="openai-model"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          void save(event.target.value);
        }}
        className="w-[190px] max-w-full border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-fg"
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </>
  );
}
