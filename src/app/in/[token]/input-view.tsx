"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useRealtime } from "@/hooks/use-realtime";
import type { UiStrings } from "@/lib/i18n";
import type { Language } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import type { Peer, ServerMessage } from "@/lib/realtime/protocol";

type Line = { id: number; body: string; createdAt: number };

/** 초안은 타자마다 오간다. 글자당 한 번씩 보내지 않도록 묶어서 보낸다. */
const DRAFT_INTERVAL_MS = 180;

export function InputView({
  token,
  language,
  strings,
  meetingTitle,
  initiallyClosed,
}: {
  token: string;
  language: Language;
  strings: UiStrings;
  meetingTitle: string;
  initiallyClosed: boolean;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [closed, setClosed] = useState(initiallyClosed);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === "message") {
      // 허브가 이 페이지 언어의 원문만 보내 준다(`realtime/hub.ts`).
      setLines((prev) =>
        prev.some((line) => line.id === message.messageId)
          ? prev
          : [...prev, { id: message.messageId, body: message.body, createdAt: message.createdAt }],
      );
    } else if (message.t === "presence") {
      setPeers(message.peers);
    } else if (message.t === "meeting-closed") {
      setClosed(true);
    }
  }, []);

  const { state, send } = useRealtime(`token=${encodeURIComponent(token)}`, onMessage);

  // 새 문장이 들어오면 따라 내려간다. 속기사는 항상 맨 아래를 본다.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  const onChange = (value: string) => {
    setText(value);

    const area = textareaRef.current;
    if (area) {
      // 자동 높이. 먼저 줄여야 내용이 짧아졌을 때도 따라 줄어든다.
      area.style.height = "auto";
      area.style.height = `${Math.min(area.scrollHeight, 220)}px`;
    }

    if (draftTimer.current) return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      send({ t: "draft", text: textareaRef.current?.value ?? "" });
    }, DRAFT_INTERVAL_MS);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending || closed) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(token)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });

      if (response.status === 409) {
        setClosed(true);
        return;
      }
      if (!response.ok) {
        setError(strings.error.sendFailed);
        return;
      }

      // 전송한 문장은 WebSocket 으로 되돌아온다. 여기서 직접 넣지 않는다.
      setText("");
      send({ t: "draft", text: "" });
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch {
      setError(strings.error.sendFailed);
    } finally {
      setSending(false);
    }
  };

  const connText =
    state === "open"
      ? strings.connection.connected
      : state === "connecting"
        ? strings.connection.reconnecting
        : strings.connection.disconnected;

  // 자기 자신은 서버가 이미 빼고 보낸다.
  const typing = peers.filter((peer) => peer.typing && peer.draft.trim());

  return (
    <div className="min-h-screen">
      <AppearanceControls strings={strings.appearance} />

      <div className="mx-auto max-w-[920px] px-8 pt-14 pb-44">
        <header className="border-b border-line pb-5">
          <div className="text-[27px] font-medium">{language.nativeName}</div>
          <div className="mt-1.5 font-mono text-[12px] text-muted">
            {strings.role.input} · {connText}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">{meetingTitle}</div>
        </header>

        {closed ? (
          <div className="mt-5 border border-line px-4 py-3 font-mono text-[13px] text-muted">
            {strings.meeting.closed}
          </div>
        ) : null}

        <div className="pt-6">
          {lines.length === 0 ? (
            <p className="font-mono text-[12px] text-muted">{strings.status.noContent}</p>
          ) : null}

          {lines.map((line) => (
            <div key={line.id} className="flex gap-[18px] py-2">
              <span className="min-w-[46px] shrink-0 pt-[0.35em] font-mono text-[12px] text-muted">
                {formatClock(line.createdAt)}
              </span>
              <p className="app-text whitespace-pre-wrap [text-wrap:pretty]">{line.body}</p>
            </div>
          ))}

          {/* 다른 속기사가 지금 치고 있는 문장. 읽기 전용이라 흐리게 둔다. */}
          {typing.map((peer) => (
            <div key={peer.clientId} className="flex gap-[18px] py-2 opacity-[0.42]">
              <span className="min-w-[46px] shrink-0 pt-[0.35em] font-mono text-[12px] text-muted">
                {peer.name}
              </span>
              <p className="app-text whitespace-pre-wrap italic [text-wrap:pretty]">
                {peer.draft}
                <span aria-hidden>▍</span>
              </p>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg">
        <div className="mx-auto max-w-[920px] px-8 py-4">
          <div className="mb-2 flex items-center justify-between gap-4 font-mono text-[11px] text-muted">
            <span>
              {strings.peers.online} {peers.length + 1}
              {typing.length ? ` · ${strings.peers.typing} ${typing.length}` : ""}
            </span>
            {error ? <span className="text-fg">{error}</span> : null}
          </div>

          <div className="flex items-end gap-4">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              disabled={closed}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={strings.input.placeholder}
              className="app-text field-sizing-content max-h-[220px] min-w-0 flex-1 resize-none border-none bg-transparent outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={closed || sending || !text.trim()}
              className="shrink-0 cursor-pointer border border-fg px-6 py-2.5 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
            >
              {sending ? strings.input.sending : strings.input.send}
            </button>
          </div>

          <div className="mt-2 font-mono text-[11px] text-muted">{strings.input.hint}</div>
        </div>
      </div>
    </div>
  );
}
