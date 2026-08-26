"use client";

import { useCallback, useMemo, useState, useTransition } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import { useRealtime } from "@/hooks/use-realtime";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";
import {
  formatClock,
  formatSourceLine,
  formatTranslationLine,
  type LogLine,
} from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";

import { AdminBusyOverlay } from "../../../admin-busy-overlay";
import { MinutesDownloadButtons } from "../minutes-download-dialog";

export function LogView({
  meetingId,
  meetingTitle,
  languages,
  lines,
  lang,
  strings,
  ui,
  displayLanguages,
}: {
  meetingId: string;
  meetingTitle: string;
  languages: Language[];
  lines: LogLine[];
  lang: LanguageCode;
  strings: AdminStrings;
  ui: UiStrings;
  displayLanguages: Language[];
}) {
  const [all, setAll] = useState<LogLine[]>(lines);
  const [selected, setSelected] = useState<LanguageCode[]>(() =>
    languages.map((language) => language.code),
  );
  const setLang = useSetAdminLang();
  const [navigating, startNavigation] = useTransition();

  // 회의가 진행되는 동안 로그 창을 띄워 둘 수 있어야 한다.
  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === "message") {
      setAll((prev) => {
        const current = prev.find((line) => line.messageId === message.messageId);
        if (current && current.revision > message.revision) return prev;
        const next: LogLine = {
          messageId: message.messageId,
          revision: message.revision,
          editedAt: message.editedAt,
          at: message.createdAt,
          lang: message.lang,
          kind: "source",
          body: message.body,
          speakerName: message.speakerName,
          text: formatSourceLine(message.createdAt, message.body, message.speakerName),
        };
        if (!current) return [...prev, next];
        return prev
          .filter((line) => line.messageId !== message.messageId || line.kind === "source")
          .map((line) => line.messageId === message.messageId ? next : line);
      });
    } else if (message.t === "translation" && message.status === "ok") {
      // 실패한 번역은 로그에 남기지 않는다 — 서버의 `getLogLines` 와 같은 규칙이다.
      setAll((prev) => {
        const source = prev.find(
          (line) => line.messageId === message.messageId && line.kind === "source",
        );
        if (!source || source.revision !== message.revision) return prev;
        const next: LogLine = {
          messageId: message.messageId,
          revision: message.revision,
          editedAt: message.editedAt,
          at: message.createdAt,
          lang: message.lang,
          kind: "translation",
          body: message.body,
          speakerName: message.speakerName,
          text: formatTranslationLine(
            message.createdAt,
            message.lang,
            message.body,
            message.speakerName,
          ),
        };
        const index = prev.findIndex(
          (line) => line.messageId === message.messageId &&
            line.kind === "translation" && line.lang === message.lang,
        );
        if (index < 0) return [...prev, next];
        const updated = prev.slice();
        updated[index] = next;
        return updated;
      });
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

  const nameOf = (code: LanguageCode) =>
    languages.find((language) => language.code === code)?.label ?? code;

  const downloadButton =
    "cursor-pointer border border-fg px-4 py-2 font-mono text-[13px] transition-colors hover:bg-fg hover:text-bg";

  return (
    <div lang={lang} className="mx-auto max-w-[840px] px-7 pt-14 pb-16">
      <AdminBusyOverlay label={navigating ? strings.list.loading : null} />
      <AppearanceControls
        strings={ui.appearance}
        language={{
          value: lang,
          label: strings.language.label,
          options: displayLanguages,
          onChange: (next) => startNavigation(() => setLang(next)),
        }}
      />

      <div className="mb-5 font-mono text-[11px] text-muted">
        {strings.log.notice}
      </div>

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <div className="w-full min-w-0 truncate font-mono text-[13px] text-muted sm:flex-1">
          {strings.log.title} · {meetingTitle}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <MinutesDownloadButtons
            meetingId={meetingId}
            languages={languages}
            strings={strings.log}
            buttonClass={downloadButton}
            defaultSelected={selected}
          />
        </div>
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
        <p className="py-5 font-mono text-[12px] text-muted">{strings.log.empty}</p>
      ) : null}

      {filtered.map((line, index) => (
        <div
          key={`${line.at}-${line.lang}-${line.kind}-${index}`}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3.5 gap-y-1 border-t border-line py-2.5 sm:grid-cols-[auto_auto_minmax(0,1fr)]"
        >
          <div className="whitespace-nowrap font-mono text-[13px] text-muted">
            {formatClock(line.at)}
          </div>
          <div className="font-mono text-[13px]">{nameOf(line.lang)}</div>
          <div
            className={`app-text col-span-2 [text-wrap:pretty] sm:col-span-1 ${
              line.kind === "translation" ? "text-muted" : ""
            }`}
          >
            {line.text}
            {line.editedAt ? (
              <span className="mt-1 block font-mono text-[11px] text-muted">
                ({ui.message.edited})
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
