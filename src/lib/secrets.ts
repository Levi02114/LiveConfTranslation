import { decryptSecret } from "@/lib/crypto";
import { getEngineSecret } from "@/lib/repo";
import type { TranscriptionProvider } from "@/lib/repo";
import { localTranscriptionConfigured } from "@/lib/local-runtime";
import type { EngineId } from "@/lib/translate/types";
import { z } from "zod";

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

export type EngineKeyStatus = {
  engine: EngineId;
  configured: boolean;
  hint: string | null;
  updatedAt: number | null;
};

/** OpenAI 번역은 검증된 단일 모델만 사용한다. */
export const OPENAI_TRANSLATION_MODEL = "gpt-5.6-luna";
const OPENAI_ADMIN_SECRET_ID = "openai-admin" as const;
const GOOGLE_SPEECH_SECRET_ID = "google-speech" as const;

export const googleSpeechCredentialsSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().trim().min(1).max(200),
  client_email: z.string().trim().email().max(320),
  private_key: z.string().min(100).max(10_000),
  token_uri: z.literal("https://oauth2.googleapis.com/token"),
});
export type GoogleSpeechCredentials = z.infer<typeof googleSpeechCredentialsSchema>;

/**
 * 관리자 화면에 내려 줄 상태. **평문 키는 절대 포함하지 않는다.**
 */
export function engineKeyStatus(engine: EngineId): EngineKeyStatus {
  const stored = getEngineSecret(engine);
  const configured = Boolean(engineKey(engine));

  return {
    engine,
    configured,
    hint: configured ? (stored?.hint ?? null) : null,
    updatedAt: configured ? (stored?.updatedAt ?? null) : null,
  };
}

/** 조직 사용량 API 전용 Admin API 키. 일반 번역 키와 권한·용도를 분리한다. */
export function openaiAdminKey(): string | undefined {
  const stored = getEngineSecret(OPENAI_ADMIN_SECRET_ID);
  if (!stored) return undefined;
  return decryptSecret(stored.secret) ?? undefined;
}

export function openaiAdminKeyStatus() {
  const stored = getEngineSecret(OPENAI_ADMIN_SECRET_ID);
  const configured = Boolean(openaiAdminKey());
  return {
    configured,
    hint: configured ? (stored?.hint ?? null) : null,
    updatedAt: configured ? (stored?.updatedAt ?? null) : null,
  };
}

/** Google Speech 서비스 계정. 평문 JSON은 서버 내부에서만 사용한다. */
export function googleSpeechCredentials(): GoogleSpeechCredentials | undefined {
  const stored = getEngineSecret(GOOGLE_SPEECH_SECRET_ID);
  if (!stored) return undefined;
  const decrypted = decryptSecret(stored.secret);
  if (!decrypted) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(decrypted);
  } catch {
    console.warn("[secrets] Google Speech 서비스 계정 JSON을 읽지 못했습니다.");
    return undefined;
  }
  const parsed = googleSpeechCredentialsSchema.safeParse(decoded);
  if (parsed.success) return parsed.data;
  console.warn("[secrets] Google Speech 서비스 계정 정보를 읽지 못했습니다.");
  return undefined;
}

/** 관리자 화면에 내려도 되는 Google Speech 등록 상태. */
export function googleSpeechCredentialsStatus() {
  const stored = getEngineSecret(GOOGLE_SPEECH_SECRET_ID);
  const configured = Boolean(googleSpeechCredentials());
  return {
    configured,
    hint: configured ? (stored?.hint ?? null) : null,
    updatedAt: configured ? (stored?.updatedAt ?? null) : null,
  };
}

export function transcriptionProviderConfigured(provider: TranscriptionProvider): boolean {
  if (provider === "local") return localTranscriptionConfigured();
  if (provider === "google") return Boolean(googleSpeechCredentials());
  return Boolean(engineKey("openai"));
}

/**
 * 번역에 쓸 OpenAI 언어모델.
 *
 * 세션 생성 시점이나 이전 DB 설정과 관계없이 검증된 단일 모델을 반환한다.
 * 호출부가 모두 이 함수를 사용하므로 UI와 실제 요청이 어긋나지 않는다.
 */
export function resolveOpenaiModel(): string {
  return OPENAI_TRANSLATION_MODEL;
}
