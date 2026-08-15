"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useRealtime } from "@/hooks/use-realtime";
import type { UiStrings } from "@/lib/i18n";
import type { Language } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";

export type OutputLine = {
  id: number;
  body: string;
  status: "ok" | "error";
  createdAt: number;
};

/** 맨 아래에서 이 정도 안쪽이면 "따라가는 중"으로 본다. */
const STICK_THRESHOLD_PX = 80;

export function OutputView({
  token,
  language,
  strings,
  meetingTitle,
  history,
  initiallyClosed,
}: {
  token: string;
  language: Language;
  strings: UiStrings;
  meetingTitle: string;
  history: OutputLine[];
  initiallyClosed: boolean;
}) {
  const [lines, setLines] = useState<OutputLine[]>(history);
  const [closed, setClosed] = useState(initiallyClosed);
  const [pending, setPending] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  // 사용자가 위로 올려 읽는 중이면 끌어내리지 않는다. 렌더에 쓰이지 않으므로 ref.
  const stickRef = useRef(true);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === "translation") {
      // 허브가 이 페이지 언어의 번역만 보내 준다.
      setLines((prev) =>
        prev.some((line) => line.id === message.messageId)
          ? prev
          : [
              ...prev,
              {
                id: message.messageId,
                body: message.body,
                status: message.status,
                createdAt: message.createdAt,
              },
            ],
      );
      if (!stickRef.current) setPending((count) => count + 1);
    } else if (message.t === "meeting-closed") {
      setClosed(true);
    }
  }, []);

  const { state } = useRealtime(`token=${encodeURIComponent(token)}`, onMessage);

  useEffect(() => {
    if (!stickRef.current) return;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [lines.length]);

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    stickRef.current = distance <= STICK_THRESHOLD_PX;
    if (stickRef.current) setPending(0);
  };

  const jumpToLatest = () => {
    const container = scrollRef.current;
    if (!container) return;
    stickRef.current = true;
    container.scrollTop = container.scrollHeight;
    setPending(0);
  };

  const connText =
    state === "open"
      ? strings.connection.connected
      : state === "connecting"
        ? strings.connection.reconnecting
        : strings.connection.disconnected;

  return (
    <div className="flex h-screen flex-col">
      <AppearanceControls strings={strings.appearance} />

      <header className="shrink-0 border-b border-line px-8 pt-14 pb-5">
        <div className="mx-auto max-w-[1040px]">
          <div className="text-[27px] font-medium">{language.nativeName}</div>
          <div className="mt-1.5 font-mono text-[12px] text-muted">
            {strings.role.output} · {connText}
            {closed ? ` · ${strings.meeting.closed}` : ""}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">{meetingTitle}</div>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-8">
        <div className="mx-auto max-w-[1040px] py-6">
          {lines.length === 0 ? (
            <p className="font-mono text-[12px] text-muted">{strings.status.waiting}</p>
          ) : null}

          {lines.map((line) => (
            <div key={line.id} className="flex gap-[18px] py-2.5">
              <span className="min-w-[46px] shrink-0 pt-[0.35em] font-mono text-[12px] text-muted">
                {formatClock(line.createdAt)}
              </span>
              {line.status === "ok" ? (
                <p className="app-text whitespace-pre-wrap [text-wrap:pretty]">{line.body}</p>
              ) : (
                <p className="app-text text-muted italic">{strings.status.failed}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {pending > 0 ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="fixed bottom-7 left-1/2 -translate-x-1/2 cursor-pointer border border-fg bg-bg px-4 py-2 font-mono text-[13px] transition-colors hover:bg-fg hover:text-bg"
        >
          ↓ {strings.status.newMessages} {pending}
        </button>
      ) : null}
    </div>
  );
}
