"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useRealtime } from "@/hooks/use-realtime";
import type { UiStrings } from "@/lib/i18n";
import type { Language, LanguageCode } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";
import type { CombinedEntry } from "@/lib/repo";

export function CombinedView({
  token,
  strings,
  languages,
  meetingTitle,
  history,
  initiallyClosed,
}: {
  token: string;
  strings: UiStrings;
  languages: Language[];
  meetingTitle: string;
  history: CombinedEntry[];
  initiallyClosed: boolean;
}) {
  const [entries, setEntries] = useState<CombinedEntry[]>(history);
  const [closed, setClosed] = useState(initiallyClosed);
  const bottomRef = useRef<HTMLDivElement>(null);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === "message") {
      setEntries((prev) =>
        prev.some((entry) => entry.messageId === message.messageId)
          ? prev
          : [
              ...prev,
              {
                messageId: message.messageId,
                sourceLang: message.lang,
                sourceBody: message.body,
                createdAt: message.createdAt,
                translations: [],
              },
            ],
      );
    } else if (message.t === "translation") {
      // 번역은 원문보다 늦게 도착한다. 해당 원문 묶음에 끼워 넣는다.
      setEntries((prev) =>
        prev.map((entry) =>
          entry.messageId !== message.messageId ||
          entry.translations.some((row) => row.lang === message.lang)
            ? entry
            : {
                ...entry,
                translations: [
                  ...entry.translations,
                  {
                    lang: message.lang,
                    body: message.body,
                    status: message.status,
                    error: message.error ?? null,
                  },
                ],
              },
        ),
      );
    } else if (message.t === "meeting-closed") {
      setClosed(true);
    }
  }, []);

  const { state } = useRealtime(`token=${encodeURIComponent(token)}`, onMessage);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  const connText =
    state === "open"
      ? strings.connection.connected
      : state === "connecting"
        ? strings.connection.reconnecting
        : strings.connection.disconnected;

  return (
    <div className="min-h-screen">
      <AppearanceControls strings={strings.appearance} />

      <div className="mx-auto max-w-[1400px] px-8 pt-14 pb-16">
        <header className="border-b border-line pb-5">
          <div className="text-[27px] font-medium">{meetingTitle}</div>
          <div className="mt-1.5 font-mono text-[12px] text-muted">
            {strings.role.combined} · {connText}
            {closed ? ` · ${strings.meeting.closed}` : ""}
          </div>
        </header>

        {entries.length === 0 ? (
          <p className="pt-6 font-mono text-[12px] text-muted">{strings.status.noContent}</p>
        ) : null}

        {entries.map((entry) => (
          <section key={entry.messageId} className="border-b border-line py-5">
            <div className="flex gap-[18px]">
              <span className="min-w-[46px] shrink-0 pt-[0.35em] font-mono text-[12px] text-muted">
                {formatClock(entry.createdAt)}
              </span>
              <p className="app-text whitespace-pre-wrap [text-wrap:pretty]">
                {entry.sourceBody}
              </p>
            </div>

            <div className="mt-4 grid gap-x-6 gap-y-4 pl-[64px] [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {languages
                .filter((language) => language.code !== entry.sourceLang)
                .map((language) => (
                  <Cell
                    key={language.code}
                    language={language}
                    entry={entry}
                    waiting={strings.status.waiting}
                    failed={strings.status.failed}
                  />
                ))}
            </div>
          </section>
        ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function Cell({
  language,
  entry,
  waiting,
  failed,
}: {
  language: Language;
  entry: CombinedEntry;
  waiting: string;
  failed: string;
}) {
  const translation = entry.translations.find(
    (row) => row.lang === (language.code as LanguageCode),
  );

  return (
    <div className="border-l border-line pl-4">
      <div className="mb-1.5 font-mono text-[11px] text-muted">{language.nativeName}</div>
      {!translation ? (
        <p className="font-mono text-[12px] text-muted">{waiting}</p>
      ) : translation.status === "ok" ? (
        <p className="app-text whitespace-pre-wrap [text-wrap:pretty]">{translation.body}</p>
      ) : (
        <p className="font-mono text-[12px] text-muted italic">{failed}</p>
      )}
    </div>
  );
}
