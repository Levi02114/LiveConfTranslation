"use client";

import { useAppearance } from "@/hooks/use-appearance";
import type { UiStrings } from "@/lib/i18n";

/**
 * 테마·글자 크기 조절. 모든 페이지 오른쪽 위에 떠 있다.
 *
 * **저장은 이 브라우저에만 된다.** 참석자 한 명이 글자를 키운 게 다른 사람 화면까지
 * 바꾸면 안 되기 때문이다(`lib/appearance.ts`).
 *
 * 문구를 인자로 받는 이유: 참석자 페이지는 그 페이지 언어로, 관리자 화면은
 * 한국어로 나와야 한다.
 */
export function AppearanceControls({ strings }: { strings: UiStrings["appearance"] }) {
  const { theme, fontSize, toggleTheme, stepFontSize } = useAppearance();

  // 아직 고른 적이 없으면(theme === null) 기기 설정을 따르는 중이다.
  // 그 상태에서 특정 라벨을 확정해 보여 주면 화면과 어긋나므로 비워 둔다.
  const label = theme === "dark" ? strings.dark : theme === "light" ? strings.light : "—";

  const button =
    "cursor-pointer border border-line px-2 py-1 leading-none transition-colors hover:bg-fg hover:text-bg";

  return (
    <div className="fixed top-2.5 right-3.5 z-50 flex items-center gap-3 font-mono text-[11px] text-muted opacity-60 transition-opacity hover:opacity-100">
      <button type="button" onClick={toggleTheme} title={strings.theme} className={button}>
        {label}
      </button>
      <div className="flex items-center gap-1.5">
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
    </div>
  );
}
