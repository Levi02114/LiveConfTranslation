import { type LanguageCode, languageLogName } from "@/lib/languages";

/**
 * 회의 로그 한 줄의 형식.
 *
 *   원문:   [2026-08-15 14:03:11] (안녕하세요)
 *   번역문: [2026-08-15 14:03:12] (Translated: Vietnamese) (Xin chào)
 *
 * 로그는 사람이 읽고 `.txt` 로 받아 가는 산출물이라 형식을 여기 한 곳에서만 만든다.
 */

export type LogLine = {
  /** 정렬용 정렬 키 */
  at: number;
  /** 이 줄이 속한 언어. 필터링에 쓴다. */
  lang: LanguageCode;
  kind: "source" | "translation";
  text: string;
};

/**
 * 로컬 시각 기준 `YYYY-MM-DD HH:mm:ss`.
 *
 * 로그를 읽는 사람과 회의가 열린 곳이 같은 지역이라는 전제다.
 * `toISOString()` 은 UTC 라 회의록으로는 오히려 헷갈린다.
 */
export function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function formatSourceLine(at: number, body: string): string {
  return `[${formatTimestamp(at)}] (${body})`;
}

export function formatTranslationLine(
  at: number,
  lang: LanguageCode,
  body: string,
): string {
  return `[${formatTimestamp(at)}] (Translated: ${languageLogName(lang)}) (${body})`;
}

/** 로그 줄들을 `.txt` 본문으로 합친다. */
export function renderLogFile(lines: LogLine[]): string {
  return lines.map((line) => line.text).join("\n") + "\n";
}
