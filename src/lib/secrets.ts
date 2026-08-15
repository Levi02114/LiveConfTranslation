import "server-only";

import { decryptSecret, maskSecret } from "@/lib/crypto";
import { deeplApiKey, googleApiKey, openaiApiKey } from "@/lib/env";
import { getEngineSecret } from "@/lib/repo";
import type { EngineId } from "@/lib/translate/types";

/**
 * 번역 엔진 API 키를 어디서 가져올지 정하는 곳.
 *
 * **DB(관리자가 화면에서 등록) → 환경변수** 순으로 본다. 관리자가 방금 등록한
 * 값이 서버 재시작 없이 바로 먹혀야 하기 때문이다. 환경변수는 처음 배포할 때의
 * 기본값 역할로 남는다.
 *
 * 값을 캐시하지 않는다. 회의 도중 키를 바꾸는 상황(할당량 초과, 키 교체)이
 * 이 기능의 존재 이유인데, 캐시하면 그 때 즉시 반영되지 않는다. 복호화는
 * HMAC 한 번 + 짧은 문자열 AES 라 번역 왕복(수백 ms)에 비하면 무시할 수 있다.
 */

const FROM_ENV: Record<EngineId, () => string | undefined> = {
  google: googleApiKey,
  deepl: deeplApiKey,
  openai: openaiApiKey,
};

export type KeySource = "db" | "env";

export type ResolvedKey = {
  key: string;
  source: KeySource;
};

export function resolveEngineKey(engine: EngineId): ResolvedKey | null {
  const stored = getEngineSecret(engine);
  if (stored) {
    const key = decryptSecret(stored.secret);
    // 복호화 실패는 대개 SESSION_SECRET 교체다. 조용히 환경변수로 넘어가면
    // 관리자가 등록해 둔 키가 왜 안 먹는지 알 수 없으므로 로그를 남긴다.
    if (key) return { key, source: "db" };
    console.warn(
      `[secrets] ${engine} 키를 복호화하지 못했습니다. SESSION_SECRET 이 바뀌었다면 다시 등록해야 합니다.`,
    );
  }

  const fallback = FROM_ENV[engine]();
  return fallback ? { key: fallback, source: "env" } : null;
}

/** 실제 호출에 쓸 키만 필요할 때. */
export function engineKey(engine: EngineId): string | undefined {
  return resolveEngineKey(engine)?.key;
}

/**
 * 관리자 화면에 내려 줄 상태. **평문 키는 절대 포함하지 않는다.**
 *
 * 환경변수에서 온 키는 DB 에 힌트가 없으므로 여기서 마스킹해 만든다.
 */
export function engineKeyStatus(engine: EngineId): {
  engine: EngineId;
  configured: boolean;
  source: KeySource | null;
  hint: string | null;
  updatedAt: number | null;
} {
  const stored = getEngineSecret(engine);
  const resolved = resolveEngineKey(engine);

  return {
    engine,
    configured: Boolean(resolved),
    source: resolved?.source ?? null,
    hint:
      resolved?.source === "db"
        ? (stored?.hint ?? null)
        : resolved
          ? maskSecret(resolved.key)
          : null,
    updatedAt: resolved?.source === "db" ? (stored?.updatedAt ?? null) : null,
  };
}
