import "server-only";

import { decryptSecret } from "@/lib/crypto";
import { getEngineSecret, getEngineSetting } from "@/lib/repo";
import type { EngineId } from "@/lib/translate/types";

/**
 * 번역 엔진 API 키를 어디서 가져올지 정하는 곳.
 *
 * 관리자가 화면에서 등록해 DB에 암호화한 값만 쓴다. 관리자가 방금 등록한 값이
 * 서버 재시작 없이 바로 먹혀야 하므로 별도로 캐시하지 않는다.
 *
 * 값을 캐시하지 않는다. 회의 도중 키를 바꾸는 상황(할당량 초과, 키 교체)이
 * 이 기능의 존재 이유인데, 캐시하면 그 때 즉시 반영되지 않는다. 복호화는
 * HMAC 한 번 + 짧은 문자열 AES 라 번역 왕복(수백 ms)에 비하면 무시할 수 있다.
 */

export function engineKey(engine: EngineId): string | undefined {
  const stored = getEngineSecret(engine);
  if (!stored) return undefined;

  const key = decryptSecret(stored.secret);
  if (key) return key;
  console.warn(
    `[secrets] ${engine} 키를 복호화하지 못했습니다. SESSION_SECRET 이 바뀌었다면 다시 등록해야 합니다.`,
  );
  return undefined;
}

/**
 * 관리자 화면에 내려 줄 상태. **평문 키는 절대 포함하지 않는다.**
 */
export function engineKeyStatus(engine: EngineId): {
  engine: EngineId;
  configured: boolean;
  hint: string | null;
  updatedAt: number | null;
} {
  const stored = getEngineSecret(engine);
  const configured = Boolean(engineKey(engine));

  return {
    engine,
    configured,
    hint: configured ? (stored?.hint ?? null) : null,
    updatedAt: configured ? (stored?.updatedAt ?? null) : null,
  };
}

/**
 * 번역에 쓸 OpenAI 언어모델.
 *
 * 관리자가 화면에서 고른 값을 먼저 쓰고, 아직 고르지 않았으면 내장 기본값을 쓴다.
 * 회의 중에 모델을 바꿔도 서버 재시작 없이 다음 문장부터 먹힌다.
 *
 * `lib/env.ts` 가 아니라 여기 있는 이유: `env.ts` 는 `process.env` 전용 통로라
 * DB 를 읽어서는 안 된다(`AGENTS.md`).
 */
export function resolveOpenaiModel(): string {
  const stored = getEngineSetting("openai")?.model?.trim();
  return stored || "gpt-5.4-mini";
}
