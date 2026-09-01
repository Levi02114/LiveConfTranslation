"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { AudioTurnDetector } from "@/lib/audio-turn-detector";
import { newBrowserId } from "@/lib/browser-id";
import type { UiStrings } from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";
import { NeuralTurnDetector, redemptionMsFor } from "@/lib/neural-turn-detector";
import {
  METER_INTERVAL_MS,
  VoiceMeterTracker,
  type VoiceMeter,
} from "@/lib/voice-level";

type VoiceState = "idle" | "starting" | "active";
const voiceEventSchema = z.union([
  z.object({ t: z.literal("ready"), leaseId: z.string() }),
  z.object({ t: z.literal("partial"), text: z.string() }),
  z.object({
    t: z.literal("transcript"),
    itemId: z.string(),
    contentIndex: z.number(),
    body: z.string(),
    lang: z.string(),
    usedFallback: z.boolean(),
    leaseId: z.string(),
  }),
  z.object({
    t: z.literal("error"),
    reason: z.enum([
      "busy",
      "key-required",
      "google-unavailable",
      "local-unavailable",
      "speaker-required",
      "invalid-language",
      "lost",
    ]),
  }),
]);
type VoiceEvent = z.infer<typeof voiceEventSchema>;

type ServerVoiceInputOptions = {
  token: string;
  participantId?: string;
  strings: UiStrings["capture"];
  closed: boolean;
  speakerName?: string | null;
  onFallback?: (lang: LanguageCode) => void;
  langs: readonly LanguageCode[];
  lang?: LanguageCode | null;
  enabled?: boolean;
  requestPermissionOnMount?: boolean;
  autoSubmit?: boolean;
  rewrite?: boolean;
  onTranscript?: (body: string) => void;
};

export function useServerVoiceInput({
  token,
  participantId,
  strings,
  closed,
  speakerName,
  onFallback = () => {},
  langs,
  lang = null,
  enabled = true,
  requestPermissionOnMount = true,
  autoSubmit = true,
  rewrite = false,
  onTranscript,
}: ServerVoiceInputOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [meter, setMeter] = useState<VoiceMeter | null>(null);
  const clientId = useRef("");
  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const neuralVad = useRef<NeuralTurnDetector | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopping = useRef(false);
  const expectedClose = useRef(false);
  const speechSinceCommit = useRef(false);
  const pendingTranscripts = useRef(0);
  const submission = useRef(Promise.resolve());
  const meterLastSet = useRef(0);
  const meterPeak = useRef(0);

  // 음량 미터는 100ms 간격으로만 상태를 갱신해 불필요한 리렌더를 막는다.
  const updateMeter = useCallback((tracker: VoiceMeterTracker, rms: number, peak: number) => {
    const now = performance.now();
    meterPeak.current = Math.max(meterPeak.current, peak);
    if (now - meterLastSet.current < METER_INTERVAL_MS) return;
    meterLastSet.current = now;
    setMeter(tracker.update(rms, meterPeak.current, now));
    meterPeak.current = 0;
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const rows = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    setDevices(rows);
    setDeviceId((current) =>
      current && rows.some((device) => device.deviceId === current)
        ? current
        : (rows[0]?.deviceId ?? ""),
    );
  }, []);

  const disconnect = useCallback(() => {
    if (heartbeat.current) clearInterval(heartbeat.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    heartbeat.current = null;
    stopTimer.current = null;
    stopping.current = false;
    speechSinceCommit.current = false;
    pendingTranscripts.current = 0;
    expectedClose.current = true;
    socket.current?.close();
    socket.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void neuralVad.current?.destroy();
    neuralVad.current = null;
    void context.current?.close();
    context.current = null;
    setMeter(null);
    setPartial("");
    setState("idle");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    clientId.current = participantId || newBrowserId();
    return disconnect;
  }, [disconnect, enabled, participantId]);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [enabled, refreshDevices]);

  useEffect(() => {
    if (
      !enabled ||
      !requestPermissionOnMount ||
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia
    ) return;
    let disposed = false;
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(async (media) => {
      media.getTracks().forEach((track) => track.stop());
      if (!disposed) await refreshDevices();
    }).catch(() => {
      // 자동 권한 요청을 브라우저가 막으면 시작 버튼에서 다시 요청한다.
    });
    return () => { disposed = true; };
  }, [enabled, refreshDevices, requestPermissionOnMount]);

  const submitTranscript = useCallback(
    async (event: Extract<VoiceEvent, { t: "transcript" }>) => {
      if (!event.body.trim()) return;
      if (!autoSubmit) {
        onTranscript?.(event.body);
        return;
      }
      const response = await fetch(`/api/pages/${encodeURIComponent(token)}/transcripts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseId: event.leaseId,
          ingestKey: `${clientId.current}:${event.itemId}:${event.contentIndex}`,
          body: event.body,
          lang: event.lang,
          speakerName: speakerName || undefined,
          rewrite,
        }),
      });
      if (!response.ok) throw new Error(strings.lost);
      if (event.usedFallback) onFallback(event.lang);
    },
    [autoSubmit, onFallback, onTranscript, rewrite, speakerName, strings.lost, token],
  );

  const stop = useCallback(() => {
    if (state !== "active" || stopping.current) return;
    stopping.current = true;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (speechSinceCommit.current && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ t: "commit" }));
      pendingTranscripts.current += 1;
      speechSinceCommit.current = false;
    }
    void neuralVad.current?.destroy();
    neuralVad.current = null;
    void context.current?.close();
    context.current = null;
    setMeter(null);
    if (pendingTranscripts.current) {
      // 로컬 Whisper는 저사양 CPU에서 마지막 턴 확정에 수십 초가 걸릴 수 있다.
      stopTimer.current = setTimeout(disconnect, 60_000);
    } else {
      disconnect();
    }
  }, [disconnect, state]);

  const start = useCallback(async () => {
    if (!enabled || state !== "idle" || closed) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(strings.insecure);
      return;
    }
    setState("starting");
    setError(null);
    expectedClose.current = false;

    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        // 서버 측 noise_reduction 과의 이중 처리를 피한다(use-voice-input 과 동일).
        noiseSuppression: false,
        autoGainControl: true,
      };
      if (deviceId) audio.deviceId = { exact: deviceId };
      const media = await navigator.mediaDevices.getUserMedia({ audio });
      stream.current = media;
      void refreshDevices();

      // 네이티브 리샘플러를 우선 쓴다. 지원하지 않는 구형 WebView만 워크렛의
      // 범용 리샘플러로 내려간다.
      let audioContext: AudioContext;
      try {
        audioContext = new AudioContext({ sampleRate: 24_000 });
      } catch {
        audioContext = new AudioContext();
      }
      context.current = audioContext;
      await audioContext.audioWorklet.addModule("/pcm-capture-worklet.js");
      if (audioContext.state !== "running") await audioContext.resume();
      const source = audioContext.createMediaStreamSource(media);
      const processor = new AudioWorkletNode(audioContext, "pcm-capture");
      const silent = audioContext.createGain();
      silent.gain.value = 0;
      source.connect(processor).connect(silent).connect(audioContext.destination);

      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${scheme}://${window.location.host}/ws/transcribe?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId.current)}`,
      );
      socket.current = ws;
      ws.binaryType = "arraybuffer";
      const detector = new AudioTurnDetector();
      let ready = false;

      const commitTurn = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ t: "commit" }));
        pendingTranscripts.current += 1;
        speechSinceCommit.current = false;
      };

      // 신경망 VAD 를 백그라운드에서 단다. 로드되는 동안은 worklet RMS 경로가
      // 커밋을 맡고, 로드가 끝나면 신경망이 이어받는다.
      void NeuralTurnDetector.create(media, commitTurn, {
        redemptionMs: redemptionMsFor(langs),
        audioContext,
      }).then((vad) => {
        // 로드가 끝나기 전에 세션이 닫혔으면 붙이지 않고 바로 버린다.
        if (vad && stream.current === media) neuralVad.current = vad;
        else void vad?.destroy();
      });

      const meterTracker = new VoiceMeterTracker();
      processor.port.onmessage = (
        message: MessageEvent<{ pcm: ArrayBuffer; rms: number; peak: number }>,
      ) => {
        const { pcm, rms, peak } = message.data;
        if (!ready || ws.readyState !== WebSocket.OPEN) {
          detector.calibrate(rms);
          return;
        }
        ws.send(pcm);
        updateMeter(meterTracker, rms, peak);
        if (rms > 0.0025) speechSinceCommit.current = true;
        if (neuralVad.current) return; // 커밋은 신경망 VAD 가 결정한다
        if (detector.update(rms, performance.now()) && speechSinceCommit.current) {
          commitTurn();
        }
      };

      ws.onopen = () => ws.send(JSON.stringify({
        t: "start",
        speakerName: speakerName || undefined,
        lang: lang || undefined,
        autoSubmit,
      }));
      ws.onmessage = (message) => {
        let value;
        try {
          value = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const parsed = voiceEventSchema.safeParse(value);
        if (!parsed.success) return;
        const event = parsed.data;
        if (event.t === "ready") {
          ready = true;
          setState("active");
          heartbeat.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "heartbeat" }));
          }, 5_000);
        } else if (event.t === "partial") {
          setPartial(event.text);
        } else if (event.t === "transcript") {
          pendingTranscripts.current = Math.max(0, pendingTranscripts.current - 1);
          submission.current = submission.current
            .then(() => submitTranscript(event))
            .catch(() => {
              setError(strings.lost);
              disconnect();
            });
          const queued = submission.current;
          void queued.then(() => {
            if (
              submission.current === queued &&
              stopping.current &&
              pendingTranscripts.current === 0
            ) disconnect();
          });
        } else if (event.t === "error") {
          // 서버가 구체적인 사유를 보낸 뒤 연결을 닫아도 onclose 가 `lost`로 덮지 않는다.
          expectedClose.current = true;
          setError(
            event.reason === "busy"
              ? strings.busy
              : event.reason === "key-required"
                ? strings.keyRequired
                : event.reason === "google-unavailable"
                  ? strings.googleUnavailable
                : event.reason === "local-unavailable"
                  ? strings.localUnavailable
                : event.reason === "speaker-required"
                  ? strings.startFailed
                  : event.reason === "invalid-language"
                    ? strings.invalidLanguage
                  : strings.lost,
          );
        }
      };
      ws.onclose = () => {
        if (!expectedClose.current && !stopping.current) setError(strings.lost);
        disconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      setError(strings.permission);
      disconnect();
    }
  }, [autoSubmit, closed, deviceId, disconnect, enabled, lang, langs, refreshDevices, speakerName, state, strings, submitTranscript, token, updateMeter]);

  return { state, partial, error, devices, deviceId, setDeviceId, start, stop, meter };
}
