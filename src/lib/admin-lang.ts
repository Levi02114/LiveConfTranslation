import { type LanguageCode, isLanguageCode } from "@/lib/languages";

/**
 * 관리자 화면의 표시 언어.
 *
 * 테마·글자 크기와 달리 **쿠키**에 둔다. localStorage 로 하면 서버가 기본 언어로
 * 그린 HTML 위에 클라이언트가 다른 언어를 덮어써 하이드레이션이 어긋나고 화면이
 * 한 번 깜빡인다. 쿠키는 요청과 함께 가므로 서버가 처음부터 맞는 언어로 그린다.
 *
 * 쿠키지만 값은 이 브라우저에만 남는다 — 다른 접속자 화면에는 영향이 없다.
 */

export const ADMIN_LANG_COOKIE = "lct_admin_lang";

export const DEFAULT_ADMIN_LANG: LanguageCode = "ko";

/** 1년. 행사마다 다시 고르게 할 이유가 없다. */
export const ADMIN_LANG_MAX_AGE = 60 * 60 * 24 * 365;

export function toAdminLang(value: unknown): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_ADMIN_LANG;
}
