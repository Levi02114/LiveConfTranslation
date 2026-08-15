"use client";

import { useAppearance } from "@/hooks/use-appearance";
import type { UiStrings } from "@/lib/i18n";

/**
 * 테마·글자 크기 조절. 화면 오른쪽 위에 떠 있다.
 *
 * **저장은 이 브라우저에만 된다.** 참석자 한 명이 글자를 키운 게 다른 사람 화면까지
 * 바꾸면 안 되기 때문이다(`lib/appearance.ts`).
 *
 * 문구를 인자로 받는 이유: 참석자 페이지는 그 페이지 언어로, 관리자 화면은
 * 한국어로 나와야 한다.
 */
export function AppearanceControls({
  strings,
  /**
   * 글자 크기 조절을 띄울지.
   *
   * 이 설정은 `.app-text` 가 붙은 요소, 즉 **회의 내용**에만 걸린다. 회의 내용이
   * 없는 화면(회의 목록·로그인)에서는 눌러도 아무 일이 일어나지 않으므로 감춘다.
   * 동작하지 않는 컨트롤을 띄워 두면 사용자가 고장으로 읽는다.
   */
  textSize = true,
}: {
  strings: UiStrings["appearance"];
  textSize?: boolean;
}) {
  const { effectiveTheme, fontSize, toggleTheme, stepFontSize } = useAppearance();

  const button =
    "cursor-pointer border border-line px-2 py-1 leading-none transition-colors hover:bg-fg hover:text-bg";

  return (
    <div className="fixed top-2.5 right-3.5 z-50 flex items-center gap-3 font-mono text-[11px] text-muted opacity-60 transition-opacity hover:opacity-100">
      <button
        type="button"
        onClick={toggleTheme}
        title={strings.theme}
        aria-label={strings.theme}
        className={button}
        /*
         * 라벨이 기기 설정에 따라 정해지므로 서버가 렌더한 값과 다를 수 있다.
         * 하이드레이션 직후 올바른 값으로 교정되는, 의도된 차이다.
         */
        suppressHydrationWarning
      >
        {effectiveTheme === "dark" ? strings.dark : strings.light}
      </button>

      {textSize ? (
        <div className="flex items-center gap-1.5" title={strings.textSize}>
          <button
            type="button"
            onClick={() => stepFontSize(-1)}
            title={strings.decrease}
            aria-label={strings.decrease}
            className={button}
          >
            −
          </button>
          <span className="min-w-[26px] text-center tracking-[0.05em]">{fontSize}</span>
          <button
            type="button"
            onClick={() => stepFontSize(1)}
            title={strings.increase}
            aria-label={strings.increase}
            className={button}
          >
            ＋
          </button>
        </div>
      ) : null}
    </div>
  );
}
