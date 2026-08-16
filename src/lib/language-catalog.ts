import type { Language, LanguageCode } from "@/lib/languages";

/**
 * 관리자가 고를 수 있는 언어 목록.
 *
 * **Google 번역 v2 가 지원하는 언어 집합**을 관리자용 언어 카탈로그로 쓴다.
 *
 * 코드만 적는다. 화면에 쓸 이름 세 벌은 `Intl.DisplayNames` 가 만들어 준다
 * (`lib/languages.ts`). ICU 76 기준 아래 135개 모두 이름이 나오는 것을 확인했다.
 *
 * 목록을 외부 API 로 받아오지 않는 이유: 인터넷이 없는 로컬 네트워크가 전제다.
 */
export const LANGUAGE_CATALOG: readonly LanguageCode[] = [
  "af", "ak", "am", "ar", "as", "ay", "az",
  "bm", "be", "bn", "bho", "bs", "bg",
  "ca", "ceb", "ckb", "co", "cs", "cy",
  "da", "de", "doi", "dv",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "fi", "fil", "fr", "fy",
  "ga", "gd", "gl", "gn", "gom", "gu",
  "ha", "haw", "he", "hi", "hmn", "hr", "ht", "hu", "hy",
  "id", "ig", "ilo", "is", "it",
  "ja", "jv",
  "ka", "kk", "km", "kn", "ko", "kri", "ku", "ky",
  "la", "lb", "lg", "ln", "lo", "lt", "lus", "lv",
  "mai", "mg", "mi", "mk", "ml", "mn", "mni-Mtei", "mr", "ms", "mt", "my",
  "ne", "nl", "no", "nso", "ny",
  "om", "or",
  "pa", "pl", "ps", "pt", "pt-BR",
  "qu",
  "ro", "ru", "rw",
  "sa", "sd", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tr", "ts", "tt",
  "ug", "uk", "ur", "uz",
  "vi",
  "xh",
  "yi", "yo",
  "zh-CN", "zh-TW", "zu",
] as const;

const CATALOG = new Set<string>(LANGUAGE_CATALOG);

export function isCatalogLanguage(code: LanguageCode): boolean {
  return CATALOG.has(code);
}

/**
 * 언어 검색.
 *
 * 코드·원어 이름·표시 언어 이름·영어 이름을 **모두** 훑는다. 관리자가 일본어를
 * 찾을 때 `일본어` 로 칠지 `japanese` 로 칠지 `日本語` 로 칠지 `ja` 로 칠지 모른다.
 */
export function matchesLanguageQuery(language: Language, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [language.code, language.nativeName, language.label, language.logName].some((value) =>
    value.toLowerCase().includes(needle),
  );
}
