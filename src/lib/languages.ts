/**
 * 서비스가 다루는 언어.
 *
 * `code` 는 내부 식별자이자 API/URL 에 노출되는 값이다.
 * `logName` 은 회의 로그의 `(Translated: ...)` 에 들어가는 영어 표기로, 로그 형식을
 * 고정하기 위해 언어별로 한 가지만 쓴다.
 */
export type LanguageCode = "ko" | "vi" | "th" | "si";

export type Language = {
  code: LanguageCode;
  /** 관리자 화면(한국어)에서 쓰는 이름 */
  label: string;
  /** 해당 언어 사용자에게 보여줄 이름. 입력/출력 페이지 헤더에 쓴다. */
  nativeName: string;
  /** 회의 로그에 남기는 영어 표기 */
  logName: string;
};

export const LANGUAGES: readonly Language[] = [
  { code: "ko", label: "한국어", nativeName: "한국어", logName: "Korean" },
  { code: "vi", label: "베트남어", nativeName: "Tiếng Việt", logName: "Vietnamese" },
  { code: "th", label: "태국어", nativeName: "ไทย", logName: "Thai" },
  { code: "si", label: "싱할라어", nativeName: "සිංහල", logName: "Sinhala" },
] as const;

/** 회의를 새로 만들 때 기본으로 채워지는 언어 세트 */
export const DEFAULT_LANGUAGES: readonly LanguageCode[] = ["ko", "vi", "th", "si"];

const BY_CODE = new Map(LANGUAGES.map((language) => [language.code, language]));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && BY_CODE.has(value as LanguageCode);
}

export function getLanguage(code: LanguageCode): Language {
  const language = BY_CODE.get(code);
  if (!language) throw new Error(`알 수 없는 언어 코드: ${code}`);
  return language;
}

export function languageLogName(code: LanguageCode): string {
  return getLanguage(code).logName;
}
