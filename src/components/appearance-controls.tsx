"use client";

import { useAppearance } from "@/hooks/use-appearance";
import { FONT_SIZE_LABELS } from "@/lib/appearance";
import type { UiStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";

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
   * 전체 화면의 글자 배율을 조절한다. 필요한 화면에서만 감출 수 있도록 남겨 둔다.
   */
  textSize = true,
  language,
  qr,
}: {
  strings: UiStrings["appearance"];
  textSize?: boolean;
  /**
   * 화면 언어 선택. 관리자 화면과 특정 언어가 없는 통합 조회에서 넘어온다.
   */
  language?: {
    value: LanguageCode;
    label: string;
    /**
     * 고를 수 있는 언어.
     *
     * 예전에는 이 컴포넌트가 `LANGUAGES` 상수를 직접 읽었는데, 언어가 DB 로
     * 옮겨 간 지금은 클라이언트가 알 수 없다. 서버가 내려 준다.
     */
    options: readonly Language[];
    onChange: (next: LanguageCode) => void;
  };
  /** 관리자 주소를 휴대전화로 열기 위한 QR 진입점. */
  qr?: { label: string; onClick: () => void };
}) {
  const { effectiveTheme, fontSize, toggleTheme, stepFontSize } = useAppearance();

  const button =
    "inline-flex h-[1.3rem] cursor-pointer items-center justify-center border border-line px-[8px] leading-none transition-colors hover:bg-fg hover:text-bg";

  return (
    <div className="fixed top-2.5 right-3 left-3 z-50 flex items-center justify-end gap-[6px] bg-bg font-mono text-[11px] text-muted sm:left-auto sm:right-3.5 sm:gap-3">
      {qr ? (
        <button
          type="button"
          onClick={qr.onClick}
          title={qr.label}
          aria-label={qr.label}
          className={`${button} min-w-[1.3rem] shrink-0 px-[6px] text-[11px]`}
        >
          QR
        </button>
      ) : null}

      {language ? (
        <select
          value={language.value}
          onChange={(event) => language.onChange(event.target.value)}
          title={language.label}
          aria-label={language.label}
          className="h-[1.3rem] min-w-0 flex-1 cursor-pointer border border-line bg-bg px-[6px] font-mono text-[11px] text-muted outline-none hover:text-fg sm:flex-none"
        >
          {language.options.map((item) => (
            // 어느 언어로 보고 있든 읽을 수 있도록 그 언어 표기로 낸다.
            <option key={item.code} value={item.code}>
              {item.nativeName}
            </option>
          ))}
        </select>
      ) : null}

      <button
        type="button"
        onClick={toggleTheme}
        title={strings.theme}
        aria-label={strings.theme}
        className={`${button} w-[calc(5.75em+18px)] shrink-0 text-[clamp(10px,0.5rem,16px)]`}
        /*
         * 라벨이 기기 설정에 따라 정해지므로 서버가 렌더한 값과 다를 수 있다.
         * 하이드레이션 직후 올바른 값으로 교정되는, 의도된 차이다.
         */
        suppressHydrationWarning
      >
        {effectiveTheme === "dark" ? strings.light : strings.dark}
      </button>

      {textSize ? (
        <div className="flex items-center gap-[6px]" title={strings.textSize}>
          <button
            type="button"
            onClick={() => stepFontSize(-1)}
            title={strings.decrease}
            aria-label={strings.decrease}
            className={button}
          >
            −
          </button>
          <span className="inline-flex h-[1.3rem] min-w-[44px] items-center justify-center text-center tracking-[0.05em]">
            {FONT_SIZE_LABELS[fontSize]}
          </span>
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
