/*
 * 이 모듈에는 `server-only` 를 걸지 않는다.
 *
 * 커스텀 서버(`server.ts`)가 Next 번들러를 거치지 않고 직접 불러오는데,
 * `server-only` 는 번들러 밖에서 로드되면 무조건 던지도록 만들어진 패키지다.
 *
 * 대신 이 파일은 node: 내장 모듈에 의존하므로, 클라이언트 컴포넌트에서 잘못
 * 불러오면 번들 단계에서 바로 실패한다 — 보호는 그대로 유지된다.
 */
/**
 * 환경변수 접근 지점.
 *
 * 값을 여기서만 읽어, 어떤 변수가 필요한지 한 파일만 보면 알 수 있게 한다.
 * 필수 값은 **처음 쓰일 때** 검증한다. 모듈 로드 시점에 던지면 `next build` 가
 * 환경변수 없이 도는 CI 에서 깨진다.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.example 을 .env.local 로 복사한 뒤 채워 주세요.`,
    );
  }
  return value;
}

/** 관리자 로그인 비밀번호 */
export function adminPassword(): string {
  return required("ADMIN_PASSWORD");
}

/** 관리자 세션 쿠키 서명 키. 바뀌면 기존 로그인 세션이 모두 무효가 된다. */
export function sessionSecret(): string {
  return required("SESSION_SECRET");
}

/** SQLite 파일 경로. 기본값은 저장소 안의 `data/` 폴더. */
export function databasePath(): string {
  return process.env.DATABASE_PATH ?? "data/meetings.db";
}

/**
 * DeepL 엔드포인트.
 *
 * 무료 플랜 키는 `:fx` 로 끝나고 `api-free.deepl.com` 을 써야 한다.
 * 명시적으로 지정하고 싶으면 `DEEPL_API_URL` 로 덮어쓴다.
 *
 * 키를 인자로 받는 이유: 관리자가 화면에서 등록한 키는 DB 에 있어 환경변수에
 * 없다. 엔드포인트는 **실제로 쓰는 키**를 보고 정해야 한다.
 */
export function deeplApiUrl(key: string | undefined): string {
  const explicit = process.env.DEEPL_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return key?.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

/**
 * OpenAI 호환 엔드포인트.
 *
 * 기본은 OpenAI 본진이지만, 사내에 OpenAI 호환 게이트웨이를 두는 경우가 있어
 * 바꿀 수 있게 열어 둔다.
 */
export function openaiBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
}

/** 커스텀 서버가 OpenAI Realtime 전사 WebSocket에 연결할 주소. */
export function openaiRealtimeTranscribeUrl(): string {
  const url = new URL(`${openaiBaseUrl()}/realtime`);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  // 전사 세션은 모델명이 아니라 intent 로 연다. ?model=<전사 모델> 은 거부된다.
  url.searchParams.set("intent", "transcription");
  return url.toString();
}

/** 관리자 세션 유효 기간(초). 기본 12시간 — 하루짜리 행사를 덮는다. */
export function sessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12 * 60 * 60;
}

/** Electron 첫 실행 마법사가 설치한 로컬 AI 파일 경로. */
export function localLlamaServerPath(): string | undefined {
  return process.env.LOCAL_LLAMA_SERVER_PATH?.trim() || undefined;
}

export function localTranslationModelPath(): string | undefined {
  return process.env.LOCAL_TRANSLATION_MODEL_PATH?.trim() || undefined;
}

export function localTranslationModelId(): string | undefined {
  return process.env.LOCAL_TRANSLATION_MODEL_ID?.trim() || undefined;
}

export function localWhisperServerPath(): string | undefined {
  return process.env.LOCAL_WHISPER_SERVER_PATH?.trim() || undefined;
}

export function localTranscriptionModelPath(): string | undefined {
  return process.env.LOCAL_TRANSCRIPTION_MODEL_PATH?.trim() || undefined;
}

export function localAiUseGpu(): boolean {
  return process.env.LOCAL_AI_USE_GPU !== "0";
}

/** Electron이 만든 로컬 HTTPS PFX와 모바일 설치용 CA 인증서. */
export function localHttpsPfxPath(): string | undefined {
  return process.env.LOCAL_HTTPS_PFX_PATH?.trim() || undefined;
}

export function localHttpsPfxPassword(): string | undefined {
  return process.env.LOCAL_HTTPS_PFX_PASSWORD?.trim() || undefined;
}

export function localHttpsCaPath(): string | undefined {
  return process.env.LOCAL_HTTPS_CA_PATH?.trim() || undefined;
}

export function localHttpsPort(): number {
  const value = Number.parseInt(process.env.LOCAL_HTTPS_PORT ?? "3443", 10);
  return Number.isFinite(value) && value > 0 && value < 65536 ? value : 3443;
}
