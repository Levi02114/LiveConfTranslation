"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useRealtime } from "@/hooks/use-realtime";
import { useVoiceInput } from "@/hooks/use-voice-input";
import type { UiStrings } from "@/lib/i18n-builtin";
import { type Language, textDirection } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";
import type { Message } from "@/lib/repo";

export function CaptureView({
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
  history: Message[];
  initiallyClosed: boolean;
}) {
  const [messages, setMessages] = useState(history);
  const [closed, setClosed] = useState(initiallyClosed);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceInput({
    token,
    strings: strings.capture,
    closed,
    requestPermissionOnMount: true,
  });
  const { stop: stopVoice } = voice;

  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.t === "message" && message.lang === language.code) {
        setMessages((previous) =>
          previous.some((item) => item.id === message.messageId)
            ? previous
            : [
                ...previous,
                {
                  id: message.messageId,
                  meetingId: "",
                  pageId: null,
                  lang: message.lang,
                  body: message.body,
                  createdAt: message.createdAt,
                },
              ],
        );
      } else if (message.t === "meeting-closed") {
        setClosed(true);
        stopVoice();
      }
    },
    [language.code, stopVoice],
  );

  useRealtime(`token=${encodeURIComponent(token)}`, onMessage);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages.length, voice.partial]);

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

  const status =
    voice.state === "active"
      ? strings.capture.listening
      : voice.state === "starting"
        ? strings.capture.starting
        : strings.capture.standby;

  return (
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
              {strings.role.capture} · {status}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted">{meetingTitle}</div>
          </header>

          {closed ? (
            <div className="mt-5 border border-line px-4 py-3 font-mono text-[13px] text-muted">
              {strings.meeting.closed}
            </div>
          ) : null}

          <div className="mt-auto pt-6">
            {messages.length === 0 && !voice.partial ? (
              <p className="font-mono text-[12px] text-muted">{strings.status.noContent}</p>
            ) : null}
            {messages.map((message) => (
              <div
                key={message.id}
                className="grid grid-cols-1 gap-1 border-b border-line py-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-4"
              >
                <time className="whitespace-nowrap font-mono text-[12px] text-muted sm:pt-[0.4em]">
                  {formatClock(message.createdAt)}
                </time>
                <p className="app-text min-w-0 whitespace-pre-wrap [text-wrap:pretty]">{message.body}</p>
              </div>
            ))}
            {voice.partial ? (
              <div className="grid grid-cols-1 gap-1 border-b border-line py-5 opacity-50 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-4">
                <span className="whitespace-nowrap font-mono text-[12px] text-muted sm:pt-[0.4em]">
                  {strings.capture.partial}
                </span>
                <p className="app-text min-w-0 whitespace-pre-wrap italic [text-wrap:pretty]">
                  {voice.partial}<span aria-hidden>▍</span>
                </p>
              </div>
            ) : null}
            <div className="h-12" aria-hidden />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-bg">
        <div className="mx-auto max-w-[920px] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 font-mono text-[11px] text-muted">
              <span className="mb-1.5 block">{strings.capture.microphone}</span>
              <select
                value={voice.deviceId}
                onChange={(event) => voice.setDeviceId(event.target.value)}
                disabled={voice.state !== "idle"}
                className="h-11 w-full border border-line bg-bg px-3 text-fg outline-none disabled:opacity-50"
              >
                {voice.devices.length === 0 ? <option value="">{strings.capture.microphone}</option> : null}
                {voice.devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `${strings.capture.microphone} ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={closed || voice.state === "starting"}
              onClick={() => (voice.state === "active" ? voice.stop() : void voice.start())}
              className="min-h-11 cursor-pointer border border-fg px-5 py-2.5 font-mono text-[14px] hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
            >
              {voice.state === "active"
                ? strings.capture.stop
                : voice.state === "starting"
                  ? strings.capture.starting
                  : strings.capture.start}
            </button>
          </div>
          {voice.error ? <p className="mt-2 font-mono text-[11px] text-fg">{voice.error}</p> : null}
        </div>
      </div>
    </div>
  );
}
