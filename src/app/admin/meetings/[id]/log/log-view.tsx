"use client";

import { useCallback, useMemo, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useRealtime } from "@/hooks/use-realtime";
import { getStrings } from "@/lib/i18n";
import type { Language, LanguageCode } from "@/lib/languages";
import {
  formatClock,
  formatSourceLine,
  formatTranslationLine,
  type LogLine,
} from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";

const strings = getStrings("ko");

export function LogView({
  meetingId,
  meetingTitle,
  languages,
  lines,
}: {
  meetingId: string;
  meetingTitle: string;
  languages: Language[];
  lines: LogLine[];
}) {
  const [all, setAll] = useState<LogLine[]>(lines);
  const [selected, setSelected] = useState<LanguageCode[]>(() =>
    languages.map((language) => language.code),
  );

  // 회의가 진행되는 동안 로그 창을 띄워 둘 수 있어야 한다.
  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === "message") {
      setAll((prev) => [
        ...prev,
        {
          at: message.createdAt,
          lang: message.lang,
          kind: "source",
          text: formatSourceLine(message.createdAt, message.body),
        },
      ]);
    } else if (message.t === "translation" && message.status === "ok") {
      // 실패한 번역은 로그에 남기지 않는다 — 서버의 `getLogLines` 와 같은 규칙이다.
      setAll((prev) => [
        ...prev,
        {
          at: message.createdAt,
          lang: message.lang,
          kind: "translation",
          text: formatTranslationLine(message.createdAt, message.lang, message.body),
        },
      ]);
    }
  }, []);

  useRealtime(`meeting=${encodeURIComponent(meetingId)}`, onMessage);

  const filtered = useMemo(
    () => all.filter((line) => selected.includes(line.lang)),
    [all, selected],
  );

  const toggle = (code: LanguageCode) => {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((value) => value !== code) : [...prev, code],
    );
  };

  /**
   * 화면에서 보고 있는 필터 그대로 받아야 한다. 그래서 클라이언트가 만든 텍스트를
   * 내려받는 대신 같은 조건을 서버에 넘긴다 — 파일 내용이 한 곳에서만 만들어진다.
   */
  const downloadUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("format", "txt");
    // 전부 선택한 상태는 필터 없음과 같다. URL 을 짧게 둔다.
    if (selected.length !== languages.length) {
      for (const code of selected) params.append("lang", code);
    }
    return `/api/meetings/${meetingId}/log?${params.toString()}`;
  }, [meetingId, selected, languages.length]);

  const nameOf = (code: LanguageCode) =>
    languages.find((language) => language.code === code)?.label ?? code;

  return (
    <div className="mx-auto max-w-[840px] px-7 pt-14 pb-16">
      <AppearanceControls strings={strings.appearance} />

      <div className="mb-5 font-mono text-[11px] text-muted">
        이 창은 로그 전용입니다 · 네비게이션 없음
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <div className="truncate font-mono text-[13px] text-muted">로그 · {meetingTitle}</div>
        <a
          href={downloadUrl}
          download
          className="shrink-0 cursor-pointer border border-fg px-4 py-2 font-mono text-[13px] transition-colors hover:bg-fg hover:text-bg"
        >
          .txt 다운로드
        </a>
      </div>

      <div className="mt-2 flex flex-wrap gap-5 border-b border-line py-4 font-mono text-[13px]">
        {languages.map((language) => (
          <label key={language.code} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={selected.includes(language.code)}
              onChange={() => toggle(language.code)}
              className="h-[15px] w-[15px] accent-[var(--fg)]"
            />
            <span>{language.label}</span>
          </label>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-5 font-mono text-[12px] text-muted">표시할 로그가 없습니다</p>
      ) : null}

      {filtered.map((line, index) => (
        <div
          key={`${line.at}-${line.lang}-${line.kind}-${index}`}
          className="grid grid-cols-[56px_58px_1fr] items-baseline gap-3.5 border-t border-line py-2.5"
        >
          <div className="font-mono text-[13px] text-muted">{formatClock(line.at)}</div>
          <div className="font-mono text-[13px]">{nameOf(line.lang)}</div>
          <div
            className={`app-text [text-wrap:pretty] ${
              line.kind === "translation" ? "text-muted" : ""
            }`}
          >
            {line.text}
          </div>
        </div>
      ))}
    </div>
  );
}
