import type { LanguageCode } from "@/lib/languages";

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

/**
 * 쿠키 값을 표시 언어로 바꾼다.
 *
 * 등록된 언어 목록을 **인자로 받는다.** 목록은 DB 에 있는데 이 파일은 클라이언트
 * 훅(`hooks/use-admin-lang.ts`)이 쿠키 이름을 가져가는 파일이라 DB 를 부를 수
 * 없다. 호출하는 서버 컴포넌트는 어차피 드롭다운을 그리려고 목록을 들고 있다.
 *
 * 목록에 없는 값이면 한국어로 떨어진다 — 관리자가 표시 언어로 쓰던 언어를
 * 나중에 제거해도 화면이 깨지지 않는다.
 */
export function toAdminLang(
  value: unknown,
  registered: readonly LanguageCode[],
): LanguageCode {
  return typeof value === "string" && registered.includes(value)
    ? value
    : DEFAULT_ADMIN_LANG;
}
