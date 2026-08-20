"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { AppearanceControls } from "@/components/appearance-controls";
import { TranslationEntry } from "@/components/translation-entry";
import { VoiceLevelMeter } from "@/components/voice-level-meter";
import { useServerVoiceInput } from "@/hooks/use-combined-voice-input";
import { useRealtime } from "@/hooks/use-realtime";
import { upsertSource, upsertTranslation } from "@/lib/combined-entry";
import type { UiStrings } from "@/lib/i18n-builtin";
import { parseJsonResponse } from "@/lib/json-response";
import { type Language, type LanguageCode, textDirection } from "@/lib/languages";
import type { Peer, ServerMessage } from "@/lib/realtime/protocol";
import type { CombinedEntry } from "@/lib/repo";

const DRAFT_INTERVAL_MS = 180;

export function CombinedInputView({
  token,
  pageId,
  uiLang,
  fallbackLang,
  languages,
  strings,
  meetingTitle,
  history,
  initiallyClosed,
  voiceAvailable,
  speakerLabels,
}: {
  token: string;
  pageId: string;
  uiLang: LanguageCode;
  fallbackLang: LanguageCode;
  languages: Language[];
  strings: UiStrings;
  meetingTitle: string;
  history: CombinedEntry[];
  initiallyClosed: boolean;
  voiceAvailable: boolean;
  speakerLabels: boolean;
}) {
  const [entries, setEntries] = useState(history);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [closed, setClosed] = useState(initiallyClosed);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingLanguageBody, setPendingLanguageBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [speakerName, setSpeakerName] = useState("");
  const [speakerDraft, setSpeakerDraft] = useState("");
  const [speakerLoaded, setSpeakerLoaded] = useState(!speakerLabels);
  const [speakerPromptOpen, setSpeakerPromptOpen] = useState(false);
  const [speakerClaimed, setSpeakerClaimed] = useState(!speakerLabels);
  const [speakerError, setSpeakerError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameOf = useCallback(
    (code: LanguageCode) => languages.find((language) => language.code === code)?.label ?? code,
    [languages],
  );
  const showFallback = useCallback(
    (lang: LanguageCode) =>
      setFallbackNotice(strings.capture.fallback.replace("{language}", nameOf(lang))),
    [nameOf, strings.capture.fallback],
  );
  const voice = useServerVoiceInput({
    token,
    strings: strings.capture,
    closed,
    speakerName: speakerName.trim() || null,
    onFallback: showFallback,
    langs: languages.map((language) => language.code),
    preloadVad: voiceAvailable,
    requestPermissionOnMount: voiceAvailable,
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
        try { localStorage.setItem(`lct.speaker.${token}`, message.name); } catch {}
      } else {
        setSpeakerName("");
        setSpeakerClaimed(false);
        setSpeakerPromptOpen(true);
        setSpeakerError(strings.speaker.duplicate);
        try { localStorage.removeItem(`lct.speaker.${token}`); } catch {}
      }
    } else if (message.t === "message") {
      setEntries((current) => upsertSource(current, message));
    } else if (message.t === "translation") {
      setEntries((current) => upsertTranslation(current, message));
    } else if (message.t === "presence") {
      setPeers(message.peers);
    } else if (message.t === "meeting-closed") {
      setClosed(true);
      stopVoice();
    }
  }, [stopVoice, strings.speaker.duplicate, token]);
  const { state, send } = useRealtime(`token=${encodeURIComponent(token)}`, onMessage);
  const speakerReady = !speakerLabels || (speakerClaimed && Boolean(speakerName.trim()));

  useEffect(() => {
    if (!speakerLabels) return;
    const frame = requestAnimationFrame(() => {
      let saved = "";
      try { saved = localStorage.getItem(`lct.speaker.${token}`)?.trim() ?? ""; } catch {}
      setSpeakerName(saved);
      setSpeakerDraft(saved);
      setSpeakerLoaded(true);
      setSpeakerPromptOpen(!saved);
    });
    return () => cancelAnimationFrame(frame);
  }, [speakerLabels, token]);

  useEffect(() => {
    const name = speakerName.trim();
    if (speakerLabels && state === "open" && name) send({ t: "name", name });
  }, [send, speakerLabels, speakerName, state]);

  const flowSize = entries.reduce((count, entry) => count + 1 + entry.translations.length, 0);
  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [flowSize, voice.partial]);
  useEffect(() => {
    const follow = () => requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
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
      const container = scrollRef.current;
      if (container) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
  }, []);
  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 220)}px`;
  }, [text]);

  const changeText = (value: string) => {
    setText(value);
    if (draftTimer.current) return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      send({ t: "draft", text: textareaRef.current?.value ?? "" });
    }, DRAFT_INTERVAL_MS);
  };
  const submit = async (explicitLang?: LanguageCode) => {
    const body = (pendingLanguageBody ?? text).trim();
    if (!body || sending || closed || !speakerReady) return;
    textareaRef.current?.focus({ preventScroll: true });
    setSending(true);
    setError(null);
    setFallbackNotice(null);
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(token)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, lang: explicitLang, speakerName: speakerLabels ? speakerName.trim() : undefined }),
      });
      const payload = await parseJsonResponse(
        response,
        z.object({
          usedFallback: z.boolean().optional(),
          error: z.string().optional(),
          candidates: z.array(z.string()).optional(),
          message: z.object({ lang: z.string().optional() }).optional(),
        }),
      );
      if (response.status === 409) setClosed(true);
      else if (response.status === 422 && payload?.error === "language-ambiguous") {
        setPendingLanguageBody(body);
      }
      else if (!response.ok) setError(strings.error.sendFailed);
      else {
        setText("");
        setPendingLanguageBody(null);
        send({ t: "draft", text: "" });
        if (payload?.usedFallback) showFallback(payload.message?.lang ?? fallbackLang);
      }
    } catch {
      setError(strings.error.sendFailed);
    } finally {
      setSending(false);
    }
  };
  const saveSpeakerName = () => {
    const name = speakerDraft.trim();
    if (!name || state !== "open") return;
    setSpeakerError(null);
    setSpeakerClaimed(false);
    setSpeakerName(name);
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

  const connectionText =
    state === "open"
      ? strings.connection.connected
      : state === "connecting"
        ? strings.connection.reconnecting
        : strings.connection.disconnected;
  const voiceAction =
    voice.state === "starting"
      ? strings.capture.starting
      : voice.state === "active"
        ? strings.capture.stop
        : strings.capture.start;
  const typing = peers.filter((peer) => peer.typing && peer.draft.trim());

  return (
    <div lang={uiLang} dir={textDirection(uiLang)} className="flex h-dvh flex-col overflow-hidden">
      <AppearanceControls
        strings={strings.appearance}
        language={{
          value: uiLang,
          label: strings.appearance.language,
          options: languages,
          onChange: (next) => {
            const url = new URL(window.location.href);
            url.searchParams.set("ui", next);
            window.location.assign(url);
          },
        }}
      />

      {speakerLabels && speakerLoaded && speakerPromptOpen && !closed ? (
        <div role="dialog" aria-modal="true" aria-labelledby="speaker-prompt-title" className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-4 backdrop-blur-sm">
          <form className="w-full max-w-[360px] border border-line bg-bg p-5" onSubmit={(event) => { event.preventDefault(); saveSpeakerName(); }}>
            <h2 id="speaker-prompt-title" className="text-[18px] font-medium">{strings.speaker.label}</h2>
            <p className="mt-2 font-mono text-[12px] leading-5 text-muted">{strings.speaker.prompt}</p>
            <input
              autoFocus
              value={speakerDraft}
              maxLength={40}
              aria-invalid={Boolean(speakerError)}
              onChange={(event) => { setSpeakerDraft(event.target.value); setSpeakerError(null); }}
              placeholder={strings.speaker.placeholder}
              className={`mt-5 h-11 w-full border bg-bg px-3 text-fg outline-none ${speakerError ? "border-error" : "border-line focus:border-fg"}`}
            />
            {speakerError ? <p role="alert" className="mt-2 font-mono text-[12px] text-error">{speakerError}</p> : null}
            <button type="submit" disabled={!speakerDraft.trim() || state !== "open" || (Boolean(speakerName) && !speakerClaimed)} className="mt-3 h-11 w-full cursor-pointer border border-fg bg-fg text-bg disabled:cursor-default disabled:opacity-30">
              {strings.speaker.confirm}
            </button>
          </form>
        </div>
      ) : null}

      {pendingLanguageBody ? (
        <div role="dialog" aria-modal="true" aria-labelledby="language-prompt-title" className="fixed inset-0 z-50 flex items-center justify-center bg-bg px-4">
          <div className="w-full max-w-[420px] border border-line bg-bg p-5">
            <h2 id="language-prompt-title" className="text-[18px] font-medium">{strings.input.chooseLanguage}</h2>
            <p className="mt-2 font-mono text-[12px] leading-5 text-muted">{strings.input.chooseLanguageNote}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {languages.map((language) => (
                <button key={language.code} type="button" onClick={() => void submit(language.code)} className="cursor-pointer border border-line px-3 py-2 font-mono text-[13px] hover:border-fg hover:bg-fg hover:text-bg">
                  {language.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setPendingLanguageBody(null)} className="mt-4 cursor-pointer font-mono text-[12px] text-muted hover:text-fg">
              {strings.input.cancelLanguage}
            </button>
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8">
        <div className="mx-auto flex min-h-full max-w-[1100px] flex-col pt-14">
          <header className="border-b border-line pb-5">
            <h1 className="text-[27px] font-medium">{strings.role.combinedInput}</h1>
            <div className="mt-1.5 font-mono text-[12px] text-muted">{connectionText}</div>
            <div className="mt-1 font-mono text-[11px] text-muted">{meetingTitle}</div>
          </header>
          {closed ? <div className="mt-5 border border-line px-4 py-3 font-mono text-[13px] text-muted">{strings.meeting.closed}</div> : null}
          <div ref={contentRef} className="mt-auto pt-6">
            {entries.length === 0 ? <p className="font-mono text-[12px] text-muted">{strings.status.noContent}</p> : null}
            {entries.map((entry) => (
              <TranslationEntry
                key={entry.messageId}
                entry={entry}
                languages={languages}
                targetLanguages={languages.filter((language) => language.code !== entry.sourceLang)}
                strings={strings}
                showSourceLanguage
                editable={!closed && entry.pageId === pageId}
                onEdit={(body, revision) => edit(entry.messageId, body, revision)}
              />
            ))}
            {typing.map((peer) => (
              <div key={peer.clientId} className="grid grid-cols-1 gap-1 py-2 opacity-[0.42] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-[18px]">
                <span className="whitespace-nowrap font-mono text-[12px] text-muted sm:pt-[0.35em]">{peer.name}</span>
                <p className="app-text whitespace-pre-wrap italic [text-wrap:pretty]">{peer.draft}<span aria-hidden>▍</span></p>
              </div>
            ))}
            <div className="h-12" aria-hidden />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-bg">
        <div className="mx-auto max-w-[1100px] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3 font-mono text-[11px]">
            {voice.devices.length ? (
              <select aria-label={strings.capture.microphone} value={voice.deviceId} onChange={(event) => voice.setDeviceId(event.target.value)} disabled={voice.state !== "idle"} className="h-9 min-w-0 flex-1 border border-line bg-bg px-2 text-fg outline-none disabled:opacity-50 sm:max-w-[320px]">
                {voice.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${strings.capture.microphone} ${index + 1}`}</option>)}
              </select>
            ) : null}
            {!voiceAvailable ? <span className="text-muted">{strings.capture.keyRequired}</span> : null}
            {voice.partial ? <span className="min-w-0 flex-1 break-words text-fg">{strings.capture.partial}: {voice.partial}</span> : null}
            {voice.state === "active" ? <VoiceLevelMeter meter={voice.meter} strings={strings.capture} /> : null}
            {voice.error ? <span>{voice.error}</span> : null}
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted">
            <span>{strings.peers.online.replace("{count}", String(peers.length + 1))}</span>
            <span className="text-fg">{!speakerReady ? strings.speaker.required : fallbackNotice ?? error}</span>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:gap-4">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              disabled={closed || !speakerReady}
              onChange={(event) => changeText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={strings.input.placeholder}
              className="app-text field-sizing-content max-h-[220px] min-h-11 w-full min-w-0 flex-1 resize-none border-none bg-transparent outline-none"
            />
            <div className="flex shrink-0 gap-2 sm:w-auto">
              <button type="button" aria-label={voiceAction} title={voiceAction} onClick={() => voice.state === "active" ? voice.stop() : void voice.start()} disabled={!voiceAvailable || closed || !speakerReady || voice.state === "starting"} className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center border border-fg transition-colors disabled:cursor-default disabled:opacity-30 ${voice.state === "active" ? "bg-fg text-bg" : "hover:bg-fg hover:text-bg"}`}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" /></svg>
              </button>
              <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => void submit()} disabled={closed || !speakerReady || sending || !text.trim()} className="min-h-11 min-w-0 flex-1 cursor-pointer border border-fg px-4 py-2.5 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 sm:flex-none sm:px-6">
                {sending ? strings.input.sending : strings.input.send}
              </button>
            </div>
          </div>
          <div className="mt-2 font-mono text-[11px] text-muted">{strings.input.hint}</div>
        </div>
      </div>
    </div>
  );
}
