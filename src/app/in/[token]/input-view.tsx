"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { TranslationEntry } from "@/components/translation-entry";
import { VoiceLevelMeter } from "@/components/voice-level-meter";
import { useRealtime } from "@/hooks/use-realtime";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { upsertSource, upsertTranslation } from "@/lib/combined-entry";
import type { UiStrings } from "@/lib/i18n-builtin";
import { type Language, textDirection } from "@/lib/languages";
import type { Peer, ServerMessage } from "@/lib/realtime/protocol";
import type { CombinedEntry } from "@/lib/repo";
import { appendTranscriptDraft } from "@/lib/transcript-draft";

/** 초안은 타자마다 오간다. 글자당 한 번씩 보내지 않도록 묶어서 보낸다. */
const DRAFT_INTERVAL_MS = 180;

export function InputView({
  token,
  pageId,
  language,
  languages,
  strings,
  meetingTitle,
  history,
  initiallyClosed,
  voiceAvailable,
  localTranscription,
  speakerLabels,
}: {
  token: string;
  pageId: string;
  language: Language;
  languages: Language[];
  strings: UiStrings;
  meetingTitle: string;
  history: CombinedEntry[];
  initiallyClosed: boolean;
  voiceAvailable: boolean;
  localTranscription: boolean;
  speakerLabels: boolean;
}) {
  const [entries, setEntries] = useState<CombinedEntry[]>(history);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [closed, setClosed] = useState(initiallyClosed);
  const [text, setText] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakerName, setSpeakerName] = useState("");
  const [speakerDraft, setSpeakerDraft] = useState("");
  const [speakerLoaded, setSpeakerLoaded] = useState(!speakerLabels);
  const [speakerPromptOpen, setSpeakerPromptOpen] = useState(false);
  const [speakerClaimed, setSpeakerClaimed] = useState(!speakerLabels);
  const [speakerError, setSpeakerError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appendTranscript = useCallback((body: string) => {
    setText((current) => appendTranscriptDraft(current, body));
  }, []);
  const voice = useVoiceInput({
    token,
    strings: strings.capture,
    closed,
    autoSubmit: voiceMode,
    speakerName: speakerName.trim() || null,
    onTranscript: appendTranscript,
    lang: language.code,
    // 페이지 진입 때 마이크 권한을 미리 확인한다 — 시작 버튼을 눌렀을 때
    // 권한 팝업으로 멈추지 않게. 음성 입력이 없는 세션(키 미등록)에서는 묻지 않는다.
    requestPermissionOnMount: voiceAvailable,
    forceServerTransport: localTranscription,
  });
  const { stop: stopVoice } = voice;

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === "hello") {
      setSpeakerClaimed(false);
    } else if (message.t === "name-result") {
      if (message.ok) {
        setSpeakerName(message.name);
        setSpeakerDraft(message.name);
        setSpeakerClaimed(true);
        setSpeakerPromptOpen(false);
        setSpeakerError(null);
        try {
          localStorage.setItem(`lct.speaker.${token}`, message.name);
        } catch {
          // 저장소를 막은 브라우저에서는 현재 탭에서만 이름을 유지한다.
        }
      } else {
        setSpeakerName("");
        setSpeakerClaimed(false);
        setSpeakerPromptOpen(true);
        setSpeakerError(strings.speaker.duplicate);
        try {
          localStorage.removeItem(`lct.speaker.${token}`);
        } catch {
          // 위와 같다.
        }
      }
    } else if (message.t === "message") {
      setEntries((prev) => upsertSource(prev, message));
    } else if (message.t === "translation") {
      setEntries((prev) => upsertTranslation(prev, message));
    } else if (message.t === "presence") {
      setPeers(message.peers);
    } else if (message.t === "meeting-closed") {
      setClosed(true);
      stopVoice(false);
    }
  }, [stopVoice, strings.speaker.duplicate, token]);

  const { state, send } = useRealtime(`token=${encodeURIComponent(token)}`, onMessage);
  const speakerReady = !speakerLabels || (speakerClaimed && Boolean(speakerName.trim()));

  useEffect(() => {
    if (!speakerLabels) return;
    const frame = requestAnimationFrame(() => {
      let saved = "";
      try {
        saved = localStorage.getItem(`lct.speaker.${token}`)?.trim() ?? "";
      } catch {
        // 저장소를 막은 브라우저에서는 현재 탭에서만 이름을 유지한다.
      }
      setSpeakerName(saved);
      setSpeakerDraft(saved);
      setSpeakerLoaded(true);
      setSpeakerPromptOpen(!saved);
    });
    return () => cancelAnimationFrame(frame);
  }, [speakerLabels, token]);

  const saveSpeakerName = () => {
    const name = speakerDraft.trim();
    if (!name || state !== "open") return;
    setSpeakerError(null);
    setSpeakerClaimed(false);
    setSpeakerName(name);
  };

  useEffect(() => {
    const name = speakerName.trim();
    if (!speakerLabels || state !== "open" || !name) return;
    send({ t: "name", name });
  }, [send, speakerLabels, speakerName, state]);

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
  }, [flowSize, voice.partial]);

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
    if (!contentRef.current || !("ResizeObserver" in globalThis)) return;
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

  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    // 자동 높이. 먼저 줄여야 내용이 짧아졌을 때도 따라 줄어든다.
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 220)}px`;
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }, [text, voice.partial]);

  const onChange = (value: string) => {
    setText(value);

    if (draftTimer.current) return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      send({ t: "draft", text: textareaRef.current?.value ?? "" });
    }, DRAFT_INTERVAL_MS);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending || closed || !speakerReady) return;

    // 전송 버튼을 눌러도 iOS 가 키보드를 닫지 않도록 입력 포커스를 유지한다.
    textareaRef.current?.focus({ preventScroll: true });
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(token)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, speakerName: speakerLabels ? speakerName.trim() : undefined }),
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

  const selectVoiceMode = (enabled: boolean) => {
    if (voice.state !== "idle") return;
    setVoiceMode(enabled);
    send({ t: "draft", text: enabled ? "" : text });
  };

  const edit = useCallback(async (messageId: number, body: string, revision: number) => {
    try {
      const response = await fetch(
        `/api/pages/${encodeURIComponent(token)}/messages/${messageId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, revision }),
        },
      );
      return response.ok ? "ok" as const : response.status === 409 ? "conflict" as const : "error" as const;
    } catch {
      return "error" as const;
    }
  }, [token]);

  const connText =
    state === "open"
      ? strings.connection.connected
      : state === "connecting"
        ? strings.connection.reconnecting
        : strings.connection.disconnected;
  const voiceActionText =
    voice.state === "starting"
      ? strings.capture.starting
      : voice.state === "active"
        ? strings.capture.stop
        : strings.capture.start;
  const inputText = voice.partial
    ? appendTranscriptDraft(voiceMode ? "" : text, voice.partial)
    : text;

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

      {speakerLabels && speakerLoaded && speakerPromptOpen && !closed ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="speaker-prompt-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-4 backdrop-blur-sm"
        >
          <form
            className="w-full max-w-[360px] border border-line bg-bg p-5"
            onSubmit={(event) => {
              event.preventDefault();
              saveSpeakerName();
            }}
          >
            <h2 id="speaker-prompt-title" className="text-[18px] font-medium">
              {strings.speaker.label}
            </h2>
            <p className="mt-2 font-mono text-[12px] leading-5 text-muted">
              {strings.speaker.prompt}
            </p>
            <input
              autoFocus
              value={speakerDraft}
              maxLength={40}
              aria-invalid={Boolean(speakerError)}
              aria-describedby={speakerError ? "speaker-prompt-error" : undefined}
              onChange={(event) => {
                setSpeakerDraft(event.target.value);
                setSpeakerError(null);
              }}
              placeholder={strings.speaker.placeholder}
              className={`mt-5 h-11 w-full border bg-bg px-3 text-fg outline-none ${speakerError ? "border-error" : "border-line focus:border-fg"}`}
            />
            {speakerError ? (
              <p id="speaker-prompt-error" role="alert" className="mt-2 font-mono text-[12px] text-error">
                {speakerError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={
                !speakerDraft.trim() ||
                state !== "open" ||
                (Boolean(speakerName) && !speakerClaimed)
              }
              className="mt-3 h-11 w-full cursor-pointer border border-fg bg-fg text-bg disabled:cursor-default disabled:opacity-30"
            >
              {strings.speaker.confirm}
            </button>
          </form>
        </div>
      ) : null}

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
                editable={!closed && entry.pageId === pageId}
                onEdit={(body, revision) => edit(entry.messageId, body, revision)}
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
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3 font-mono text-[11px]">
            <label
              className={`flex items-center gap-2 ${
                voiceAvailable && !closed && speakerReady && voice.state === "idle"
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-40"
              }`}
            >
              <input
                type="checkbox"
                checked={voiceMode}
                disabled={!voiceAvailable || closed || !speakerReady || voice.state !== "idle"}
                onChange={(event) => selectVoiceMode(event.target.checked)}
                className="h-[15px] w-[15px] accent-[var(--fg)]"
              />
              <span>{strings.capture.toggle}</span>
            </label>

            {!voiceAvailable ? (
              <span className="text-muted">{strings.capture.keyRequired}</span>
            ) : null}

            {voiceAvailable && voice.devices.length ? (
              <select
                aria-label={strings.capture.microphone}
                value={voice.deviceId}
                onChange={(event) => voice.setDeviceId(event.target.value)}
                disabled={voice.state !== "idle"}
                className="h-9 min-w-0 flex-1 border border-line bg-bg px-2 text-fg outline-none disabled:opacity-50 sm:max-w-[320px]"
              >
                {voice.devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `${strings.capture.microphone} ${index + 1}`}
                  </option>
                ))}
              </select>
            ) : null}

            {voice.state !== "idle" ? (
              <span className="text-muted">
                {voice.state === "active" ? strings.capture.listening : strings.capture.starting}
              </span>
            ) : null}
            {voice.state === "active" ? (
              <VoiceLevelMeter meter={voice.meter} strings={strings.capture} />
            ) : null}
            {voice.error ? <span>{voice.error}</span> : null}
          </div>

          <div className="mb-2 flex items-center justify-between gap-4 font-mono text-[11px] text-muted">
            <span>
              {formatCount(strings.peers.online, peers.length + 1)}
              {typing.length ? ` · ${formatCount(strings.peers.typing, typing.length)}` : ""}
            </span>
            <span className="text-fg">
              {!speakerReady ? strings.speaker.required : error}
            </span>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:gap-4">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              disabled={closed || !speakerReady || voiceMode || voice.state !== "idle"}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={voiceMode ? strings.capture.standby : strings.input.placeholder}
              className={`app-text field-sizing-content max-h-[220px] min-h-11 w-full min-w-0 flex-1 resize-none border-none bg-transparent outline-none ${voiceMode && !voice.partial ? "opacity-40" : ""}`}
            />
            <div className="flex shrink-0 gap-2 sm:w-auto">
              {!voiceMode && voiceAvailable ? (
                <button
                  type="button"
                  aria-label={voiceActionText}
                  title={voiceActionText}
                  onClick={() =>
                    voice.state === "active" ? voice.stop() : void voice.start()
                  }
                  disabled={closed || !speakerReady || voice.state === "starting"}
                  className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center border border-fg transition-colors disabled:cursor-default disabled:opacity-30 ${
                    voice.state === "active"
                      ? "bg-fg text-bg"
                      : "hover:bg-fg hover:text-bg"
                  }`}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!voiceMode) void submit();
                  else if (voice.state === "idle") void voice.start();
                  else if (voice.state === "active") voice.stop();
                }}
                disabled={
                  closed ||
                  !speakerReady ||
                  (voiceMode
                    ? voice.state === "starting"
                    : voice.state !== "idle" || sending || !text.trim())
                }
                className="min-h-11 min-w-0 flex-1 cursor-pointer border border-fg px-4 py-2.5 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg sm:flex-none sm:px-6"
              >
                {voiceMode
                  ? voiceActionText
                  : sending
                    ? strings.input.sending
                    : strings.input.send}
              </button>
            </div>
          </div>

          <div className="mt-2 font-mono text-[11px] text-muted">
            {voiceMode ? strings.capture.standby : strings.input.hint}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}
