"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { TranslationEntry } from "@/components/translation-entry";
import { useRealtime } from "@/hooks/use-realtime";
import type { UiStrings } from "@/lib/i18n-builtin";
import { type Language, textDirection } from "@/lib/languages";
import type { Peer, ServerMessage } from "@/lib/realtime/protocol";
import type { CombinedEntry } from "@/lib/repo";

/** 초안은 타자마다 오간다. 글자당 한 번씩 보내지 않도록 묶어서 보낸다. */
const DRAFT_INTERVAL_MS = 180;

export function InputView({
  token,
  language,
  languages,
  strings,
  meetingTitle,
  history,
  initiallyClosed,
}: {
  token: string;
  language: Language;
  languages: Language[];
  strings: UiStrings;
  meetingTitle: string;
  history: CombinedEntry[];
  initiallyClosed: boolean;
}) {
  const [entries, setEntries] = useState<CombinedEntry[]>(history);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [closed, setClosed] = useState(initiallyClosed);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      setEntries((prev) =>
        prev.map((entry) =>
          entry.messageId !== message.messageId ||
          entry.translations.some((translation) => translation.lang === message.lang)
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
    } else if (message.t === "presence") {
      setPeers(message.peers);
    } else if (message.t === "meeting-closed") {
      setClosed(true);
    }
  }, []);

  const { state, send } = useRealtime(`token=${encodeURIComponent(token)}`, onMessage);

  const flowSize = entries.reduce(
    (count, entry) =>
      count +
      1 +
      (entry.sourceLang !== language.code &&
      entry.translations.some((translation) => translation.lang === language.code)
        ? 1
        : 0),
    0,
  );

  // 새 원문이나 이 페이지 언어의 번역이 들어오면 따라 내려간다.
  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [flowSize]);

  useEffect(() => {
    const follow = () => {
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
    };
    window.addEventListener("resize", follow, { passive: true });
    window.visualViewport?.addEventListener("resize", follow, { passive: true });
    return () => {
      window.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("resize", follow);
    };
  }, []);

  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

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
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
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

    // 전송 버튼을 눌러도 iOS 가 키보드를 닫지 않도록 입력 포커스를 유지한다.
    textareaRef.current?.focus({ preventScroll: true });
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
      /*
       * 아랍어·히브리어처럼 오른쪽에서 왼쪽으로 쓰는 언어는 dir 을 주지 않으면
       * 문장 부호와 숫자가 엉뚱한 자리에 붙는다. lang 은 브라우저가 줄바꿈과
       * 글꼴 대체를 그 언어 규칙으로 하게 한다.
       */
    <div
      lang={language.code}
      dir={textDirection(language.code)}
      className="flex h-dvh flex-col overflow-hidden"
    >
      <AppearanceControls strings={strings.appearance} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8">
        <div className="mx-auto flex min-h-full max-w-[920px] flex-col pt-14">
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

          <div ref={contentRef} className="mt-auto pt-6">
            {entries.length === 0 ? (
              <p className="font-mono text-[12px] text-muted">{strings.status.noContent}</p>
            ) : null}

            {entries.map((entry) => (
              <TranslationEntry
                key={entry.messageId}
                entry={entry}
                languages={languages}
                targetLanguages={entry.sourceLang === language.code ? [] : [language]}
                strings={strings}
                showSourceLanguage
              />
            ))}

            {/* 같은 입력 페이지의 다른 속기사가 지금 치고 있는 문장. */}
            {typing.map((peer) => (
              <div
                key={peer.clientId}
                className="grid grid-cols-1 gap-1 py-2 opacity-[0.42] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-[18px]"
              >
                <span className="whitespace-nowrap font-mono text-[12px] text-muted sm:pt-[0.35em]">
                  {peer.name}
                </span>
                <p className="app-text whitespace-pre-wrap italic [text-wrap:pretty]">
                  {peer.draft}
                  <span aria-hidden>▍</span>
                </p>
              </div>
            ))}

            <div className="h-12" aria-hidden />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-bg">
        <div className="mx-auto max-w-[920px] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-4">
          <div className="mb-2 flex items-center justify-between gap-4 font-mono text-[11px] text-muted">
            <span>
              {formatCount(strings.peers.online, peers.length + 1)}
              {typing.length ? ` · ${formatCount(strings.peers.typing, typing.length)}` : ""}
            </span>
            {error ? <span className="text-fg">{error}</span> : null}
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:gap-4">
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
              className="app-text field-sizing-content max-h-[220px] min-h-11 w-full min-w-0 flex-1 resize-none border-none bg-transparent outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void submit()}
              disabled={closed || sending || !text.trim()}
              className="min-h-11 w-full shrink-0 cursor-pointer border border-fg px-4 py-2.5 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg sm:w-auto sm:px-6"
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

function formatCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}
