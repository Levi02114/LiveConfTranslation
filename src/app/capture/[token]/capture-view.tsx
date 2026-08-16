"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useRealtime } from "@/hooks/use-realtime";
import type { UiStrings } from "@/lib/i18n-builtin";
import { type Language, textDirection } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";
import type { Message } from "@/lib/repo";

type CaptureState = "idle" | "starting" | "active";

type RealtimeSession = {
  leaseId: string;
  clientSecret: string;
  realtimeUrl: string;
  error?: string;
};

type TranscriptionEvent = {
  type?: string;
  item_id?: string;
  content_index?: number;
  delta?: string;
  transcript?: string;
};

// ponytail: 현장 마이크마다 레벨이 다르다. 오탐이 생기면 이 두 값만 조정한다.
const SPEECH_RMS = 0.025;
const SILENCE_MS = 700;

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
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");

  const clientId = useRef("");
  const leaseId = useRef<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioFrame = useRef<number | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const partials = useRef(new Map<string, string>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const endpoint = `/api/pages/${encodeURIComponent(token)}/realtime-session`;

  const stop = useCallback(
    (release = true) => {
      if (heartbeat.current) clearInterval(heartbeat.current);
      heartbeat.current = null;
      if (audioFrame.current !== null) cancelAnimationFrame(audioFrame.current);
      audioFrame.current = null;
      void audioContext.current?.close();
      audioContext.current = null;
      channel.current?.close();
      peer.current?.close();
      stream.current?.getTracks().forEach((track) => track.stop());
      channel.current = null;
      peer.current = null;
      stream.current = null;
      partials.current.clear();
      setPartial("");
      setCaptureState("idle");

      const currentLease = leaseId.current;
      leaseId.current = null;
      if (release && currentLease) {
        void fetch(endpoint, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseId: currentLease }),
          keepalive: true,
        });
      }
    },
    [endpoint],
  );

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
        stop();
      }
    },
    [language.code, stop],
  );

  useRealtime(`token=${encodeURIComponent(token)}`, onMessage);

  useEffect(() => {
    clientId.current = crypto.randomUUID();
    return () => stop();
  }, [stop]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages.length, partial]);

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

  const refreshDevices = useCallback(async () => {
    const available = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    setDevices(available);
    setDeviceId((current) =>
      current && available.some((device) => device.deviceId === current)
        ? current
        : (available[0]?.deviceId ?? ""),
    );
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  const submitTranscript = useCallback(
    async (sessionLease: string, itemId: string, contentIndex: number, body: string) => {
      const response = await fetch(`/api/pages/${encodeURIComponent(token)}/transcripts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseId: sessionLease,
          ingestKey: `${clientId.current}:${itemId}:${contentIndex}`,
          body,
        }),
      });
      if (response.status === 409) {
        setError(strings.capture.lost);
        stop(false);
      }
    },
    [stop, strings.capture.lost, token],
  );

  const handleEvent = useCallback(
    (raw: string, sessionLease: string) => {
      let event: TranscriptionEvent;
      try {
        event = JSON.parse(raw) as TranscriptionEvent;
      } catch {
        return;
      }

      const itemId = event.item_id;
      if (!itemId) return;
      if (event.type === "conversation.item.input_audio_transcription.delta") {
        partials.current.set(itemId, (partials.current.get(itemId) ?? "") + (event.delta ?? ""));
        setPartial([...partials.current.values()].join(" "));
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        partials.current.delete(itemId);
        setPartial([...partials.current.values()].join(" "));
        const transcript = event.transcript?.trim();
        if (transcript) void submitTranscript(sessionLease, itemId, event.content_index ?? 0, transcript);
      }
    },
    [submitTranscript],
  );

  const monitorSilence = useCallback((media: MediaStream) => {
    const context = new AudioContext();
    void context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(media).connect(analyser);
    audioContext.current = context;

    const samples = new Float32Array(analyser.fftSize);
    let heardSpeech = false;
    let silentSince = 0;

    const measure = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const speaking = Math.sqrt(sum / samples.length) >= SPEECH_RMS;
      const now = performance.now();

      if (speaking) {
        heardSpeech = true;
        silentSince = 0;
      } else if (heardSpeech) {
        silentSince ||= now;
        if (now - silentSince >= SILENCE_MS && channel.current?.readyState === "open") {
          channel.current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          heardSpeech = false;
          silentSince = 0;
        }
      }
      audioFrame.current = requestAnimationFrame(measure);
    };
    measure();
  }, []);

  const start = async () => {
    if (captureState !== "idle" || closed) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(strings.capture.insecure);
      return;
    }

    setCaptureState("starting");
    setError(null);
    try {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        throw new Error(strings.capture.permission);
      }
      await refreshDevices();

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: clientId.current }),
      });
      const session = (await response.json().catch(() => null)) as RealtimeSession | null;
      if (!response.ok || !session?.leaseId || !session.clientSecret) {
        throw new Error(response.status === 409 ? strings.capture.busy : strings.capture.startFailed);
      }
      leaseId.current = session.leaseId;

      const connection = new RTCPeerConnection();
      peer.current = connection;
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "failed") {
          setError(strings.capture.lost);
          stop();
        }
      };
      for (const track of stream.current.getAudioTracks()) connection.addTrack(track, stream.current);

      const dataChannel = connection.createDataChannel("oai-events");
      channel.current = dataChannel;
      dataChannel.onmessage = (event) => handleEvent(String(event.data), session.leaseId);

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      const answer = await fetch(session.realtimeUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.clientSecret}`,
          "content-type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!answer.ok) throw new Error(strings.capture.lost);
      await connection.setRemoteDescription({ type: "answer", sdp: await answer.text() });
      monitorSilence(stream.current);

      heartbeat.current = setInterval(async () => {
        const currentLease = leaseId.current;
        if (!currentLease) return;
        const renewed = await fetch(endpoint, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseId: currentLease }),
        }).catch(() => null);
        if (!renewed?.ok) {
          setError(strings.capture.lost);
          stop(false);
        }
      }, 5_000);
      setCaptureState("active");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : strings.capture.permission);
      stop();
    }
  };

  const status =
    captureState === "active"
      ? strings.capture.listening
      : captureState === "starting"
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
            {messages.length === 0 && !partial ? (
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
            {partial ? (
              <div className="grid grid-cols-1 gap-1 border-b border-line py-5 opacity-50 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-4">
                <span className="whitespace-nowrap font-mono text-[12px] text-muted sm:pt-[0.4em]">
                  {strings.capture.partial}
                </span>
                <p className="app-text min-w-0 whitespace-pre-wrap italic [text-wrap:pretty]">
                  {partial}<span aria-hidden>▍</span>
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
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                disabled={captureState !== "idle"}
                className="h-11 w-full border border-line bg-bg px-3 text-fg outline-none disabled:opacity-50"
              >
                {devices.length === 0 ? <option value="">{strings.capture.microphone}</option> : null}
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `${strings.capture.microphone} ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={closed || captureState === "starting"}
              onClick={() => (captureState === "active" ? stop() : void start())}
              className="min-h-11 cursor-pointer border border-fg px-5 py-2.5 font-mono text-[14px] hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
            >
              {captureState === "active"
                ? strings.capture.stop
                : captureState === "starting"
                  ? strings.capture.starting
                  : strings.capture.start}
            </button>
          </div>
          {error ? <p className="mt-2 font-mono text-[11px] text-fg">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
