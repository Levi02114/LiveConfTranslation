/**
 * 접속자별 화면 설정(테마·글자 크기).
 *
 * **서버에 저장하지 않는다.** 한 사람이 글자를 키웠다고 다른 참석자 화면이
 * 바뀌면 안 되므로 `localStorage` 에만 둔다.
 */

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const FONT_SIZES = ["sm", "md", "lg", "xl", "xxl"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  sm: "작게",
  md: "보통",
  lg: "크게",
  xl: "더 크게",
  xxl: "아주 크게",
};

export const THEME_KEY = "lct.theme";
export const FONT_SIZE_KEY = "lct.fontSize";

export const DEFAULT_FONT_SIZE: FontSize = "md";

/**
 * 첫 페인트 전에 실행되는 스크립트.
 *
 * React 가 붙기 전에 `<html>` 에 설정을 찍어야 흰 화면이 번쩍이지 않는다.
 * 그래서 훅이 아니라 문자열로 만들어 `<script>` 에 넣는다.
 */
export const APPEARANCE_INIT_SCRIPT = `
(function () {
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
    var font = localStorage.getItem(${JSON.stringify(FONT_SIZE_KEY)});
    if (font) root.setAttribute("data-font", font);
    else root.setAttribute("data-font", ${JSON.stringify(DEFAULT_FONT_SIZE)});
  } catch (e) {
    /* 시크릿 모드 등에서 localStorage 가 막혀 있어도 화면은 떠야 한다. */
  }
})();
`.trim();

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isFontSize(value: unknown): value is FontSize {
  return typeof value === "string" && (FONT_SIZES as readonly string[]).includes(value);
}
