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

export function googleApiKey(): string | undefined {
  return process.env.GOOGLE_TRANSLATE_API_KEY || undefined;
}

export function deeplApiKey(): string | undefined {
  return process.env.DEEPL_API_KEY || undefined;
}

/**
 * DeepL 엔드포인트.
 *
 * 무료 플랜 키는 `:fx` 로 끝나고 `api-free.deepl.com` 을 써야 한다.
 * 명시적으로 지정하고 싶으면 `DEEPL_API_URL` 로 덮어쓴다.
 */
export function deeplApiUrl(): string {
  const explicit = process.env.DEEPL_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return deeplApiKey()?.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
}

export function openaiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || undefined;
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

/** 번역에 쓸 OpenAI 모델. 자막은 지연이 중요해 작은 모델을 기본으로 둔다. */
export function openaiModel(): string {
  return process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-5.4-mini";
}

/** 회의를 새로 만들 때 기본으로 선택되는 번역 엔진 */
export function defaultEngine(): string {
  return process.env.TRANSLATION_ENGINE ?? "google";
}

/** 관리자 세션 유효 기간(초). 기본 12시간 — 하루짜리 행사를 덮는다. */
export function sessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12 * 60 * 60;
}
