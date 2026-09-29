"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AudioTurnDetector } from "@/lib/audio-turn-detector";
import { newBrowserId } from "@/lib/browser-id";
import { parseVoiceEvent, type VoiceEventPayload } from "@/lib/client-json";
import { voiceDiagnostic, voiceErrorType } from "@/lib/client-diagnostics";
import { releaseVoiceAudio } from "@/lib/voice-cleanup";
import type { UiStrings } from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";
import { NeuralTurnDetector } from "@/lib/neural-turn-detector";
import { DEFAULT_VOICE_SETTINGS, silenceMsFor, voiceSettingsSchema, type VoiceSettings } from "@/lib/voice-settings";
import {
  METER_INTERVAL_MS,
  VoiceMeterTracker,
  type VoiceMeter,
} from "@/lib/voice-level";

type VoiceState = "idle" | "starting" | "active" | "stopping";

type ServerVoiceInputOptions = {
  test?: { dry: boolean; provider: "openai" | "google" | "local"; settings: VoiceSettings;
    onSegment: (result: { body: string; elapsedMs: number; silenceMs: number }) => void | Promise<void> };
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
  test,
}: ServerVoiceInputOptions) {
  const testRef = useRef(test);
  const settingsRef = useRef<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const generation = useRef(0);
  const commits = useRef<Array<{ at: number; silenceMs: number }>>([]);
  const [phase, setPhase] = useState<"idle" | "speech" | "silence" | "committed">("idle");
  useEffect(() => {
    testRef.current = test ? { ...test, settings: voiceSettingsSchema.safeParse(test.settings).success ? test.settings : testRef.current?.settings ?? DEFAULT_VOICE_SETTINGS } : undefined;
  }, [test]);
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
  const vadLoading = useRef<Promise<NeuralTurnDetector | null> | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const audioNodes = useRef<AudioNode[]>([]);
  const audioCleanup = useRef<Promise<void> | null>(null);
  const disconnecting = useRef<Promise<void> | null>(null);
  const running = useRef(false);
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
    const run = generation.current;
    try {
    const rows = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    if (generation.current !== run) return;
    setDevices(rows);
    setDeviceId((current) =>
      current && rows.some((device) => device.deviceId === current)
        ? current
        : (rows[0]?.deviceId ?? ""),
    );
    } catch (error) { voiceDiagnostic("devices-failed", run, { errorType: voiceErrorType(error) }); }
  }, []);

  const releaseAudio = useCallback((run = generation.current) => {
    if (audioCleanup.current) return audioCleanup.current;
    const resources = { stream: stream.current, processor: processorRef.current, nodes: audioNodes.current,
      vad: vadLoading.current, context: context.current };
    stream.current = null; processorRef.current = null; audioNodes.current = [];
    neuralVad.current = null; vadLoading.current = null; context.current = null;
    const slow = setTimeout(() => voiceDiagnostic("cleanup-slow", run), 5000);
    const work = releaseVoiceAudio(resources, (phase, fields) => voiceDiagnostic(phase, run, fields))
      .finally(() => { clearTimeout(slow); if (audioCleanup.current === work) audioCleanup.current = null; });
    audioCleanup.current = work;
    return work;
  }, []);

  const disconnect = useCallback(() => {
    if (disconnecting.current) return disconnecting.current;
    const run = generation.current;
    const fence = ++generation.current;
    stopping.current = true;
    setState("stopping");
    voiceDiagnostic("disconnect", run, { state: "stopping" });
    commits.current = [];
    setPhase("idle");
    if (heartbeat.current) clearInterval(heartbeat.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    heartbeat.current = null;
    stopTimer.current = null;
    speechSinceCommit.current = false;
    pendingTranscripts.current = 0;
    expectedClose.current = true;
    const previousSocket = socket.current;
    if (previousSocket) {
      // A delayed close from a stopped run must not disconnect the next run.
      previousSocket.onclose = null;
      previousSocket.onopen = null;
      previousSocket.onerror = null;
      previousSocket.onmessage = null;
      try { previousSocket.close(); }
      catch (error) { voiceDiagnostic("socket-close-failed", run, { errorType: voiceErrorType(error) }); }
    }
    socket.current = null;
    setMeter(null);
    setPartial("");
    const work = releaseAudio(run).finally(() => {
      if (disconnecting.current === work) disconnecting.current = null;
      if (generation.current !== fence) return;
      stopping.current = false;
      running.current = false;
      setState("idle");
      voiceDiagnostic("stopped", run, { state: "idle" });
    });
    disconnecting.current = work;
    return work;
  }, [releaseAudio]);

  useEffect(() => {
    if (!enabled) return;
    clientId.current = participantId || newBrowserId();
    return () => { void disconnect(); };
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
    async (event: Extract<VoiceEventPayload, { t: "transcript" }>, receivedAt = performance.now()) => {
      if (testRef.current) {
        const commit = commits.current.shift();
        await testRef.current.onSegment({ body: event.body, elapsedMs: commit ? receivedAt - commit.at : 0,
          silenceMs: commit?.silenceMs ?? 0 });
        return;
      }
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

  const stop = useCallback((flush = true) => {
    voiceDiagnostic(flush ? "stop-flush" : "stop-immediate", generation.current);
    if (!flush) { void disconnect(); return; }
    if (state !== "active" || stopping.current) return;
    stopping.current = true;
    setState("stopping");
    if (speechSinceCommit.current && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ t: "commit" }));
      pendingTranscripts.current += 1;
      speechSinceCommit.current = false;
    }
    void releaseAudio();
    setMeter(null);
    if (pendingTranscripts.current) {
      // 로컬 Whisper는 저사양 CPU에서 마지막 턴 확정에 수십 초가 걸릴 수 있다.
      stopTimer.current = setTimeout(disconnect, 60_000);
    } else {
      void disconnect();
    }
  }, [disconnect, releaseAudio, state]);

  const start = useCallback(async () => {
    // A synchronous latch also covers double clicks before React commits the starting state.
    if (!enabled || state !== "idle" || closed || running.current || disconnecting.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(strings.insecure);
      return;
    }
    setState("starting");
    running.current = true;
    const run = ++generation.current;
    voiceDiagnostic("start", run, { state: "starting", mode: testRef.current ? testRef.current.dry ? "dry" : "test" : "session" });
    let stage = "microphone";
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
      if (generation.current !== run) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      voiceDiagnostic("microphone-ready", run);
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
      stage = "worklet";
      await audioContext.audioWorklet.addModule("/pcm-capture-worklet.js");
      if (generation.current !== run) return;
      if (audioContext.state !== "running") await audioContext.resume();
      if (generation.current !== run) return;
      const source = audioContext.createMediaStreamSource(media);
      audioNodes.current.push(source);
      const processor = new AudioWorkletNode(audioContext, "pcm-capture");
      processorRef.current = processor;
      const silent = audioContext.createGain();
      audioNodes.current.push(silent);
      silent.gain.value = 0;
      source.connect(processor).connect(silent).connect(audioContext.destination);

      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const dry = testRef.current?.dry === true;
      const query = testRef.current
        ? `test=1&source=${encodeURIComponent(langs[0])}&provider=${testRef.current.provider}`
        : `token=${encodeURIComponent(token)}`;
      const ws = dry ? null : new WebSocket(`${scheme}://${window.location.host}/ws/transcribe?${query}&clientId=${encodeURIComponent(clientId.current)}`);
      socket.current = ws;
      if (ws) ws.binaryType = "arraybuffer";
      let turnSilenceMs = silenceMsFor(testRef.current?.settings ?? settingsRef.current, langs);
      const nextSilenceMs = () => (turnSilenceMs = silenceMsFor(testRef.current?.settings ?? settingsRef.current, langs));
      const detector = new AudioTurnDetector(nextSilenceMs);
      let ready = dry;
      if (dry) { setState("active"); voiceDiagnostic("ready", run, { state: "active" }); }
      let lastTurnAt = performance.now();

      const commitTurn = () => {
        if (!ready || stopping.current || generation.current !== run) return;
        if (dry) void testRef.current?.onSegment({ body: "", elapsedMs: 0, silenceMs: turnSilenceMs });
        else {
          if (ws?.readyState !== WebSocket.OPEN) return;
          if (testRef.current) commits.current.push({ at: performance.now(), silenceMs: turnSilenceMs });
          ws.send(JSON.stringify({ t: "commit" }));
          pendingTranscripts.current += 1;
        }
        setPhase("committed");
        speechSinceCommit.current = false;
        lastTurnAt = performance.now();
      };

      // 신경망 VAD 를 백그라운드에서 단다. 로드되는 동안은 worklet RMS 경로가
      // 커밋을 맡고, 로드가 끝나면 신경망이 이어받는다.
      vadLoading.current = NeuralTurnDetector.create(media, commitTurn, {
        redemptionMs: turnSilenceMs,
        nextSilenceMs,
        audioContext,
      }).then((vad) => {
        // 로드가 끝나기 전에 세션이 닫혔으면 붙이지 않고 바로 버린다.
        if (vad && generation.current === run && !stopping.current) neuralVad.current = vad;
        voiceDiagnostic(vad ? "vad-ready" : "vad-fallback", run);
        // releaseAudio owns this promise and destroys late results before closing the context.
        return vad;
      });

      const meterTracker = new VoiceMeterTracker();
      processor.port.onmessage = (
        message: MessageEvent<{ pcm: ArrayBuffer; rms: number; peak: number }>,
      ) => {
        if (generation.current !== run || stopping.current) return;
        const { pcm, rms, peak } = message.data;
        if (!ready || (!dry && ws?.readyState !== WebSocket.OPEN)) {
          detector.calibrate(rms);
          return;
        }
        if (performance.now() - lastTurnAt > 20000 && !(neuralVad.current?.hasSpeech() ?? detector.hasSpeech())) {
          ws?.send(JSON.stringify({ t: "clear" }));
          lastTurnAt = performance.now();
          speechSinceCommit.current = false;
        }
        ws?.send(pcm);
        updateMeter(meterTracker, rms, peak);
        if (rms > 0.0025) speechSinceCommit.current = true;
        if (testRef.current) {
          const next = neuralVad.current?.phase() ?? detector.phase();
          setPhase((current) => next === "idle" && current === "committed" ? current : next);
        }
        if (neuralVad.current) return; // 커밋은 신경망 VAD 가 결정한다
        if (detector.update(rms, performance.now()) && speechSinceCommit.current) {
          commitTurn();
        }
      };

      if (!ws) return;
      ws.onopen = () => ws.send(JSON.stringify({
        t: "start",
        speakerName: speakerName || undefined,
        lang: lang || undefined,
        autoSubmit,
      }));
      ws.onmessage = (message) => {
        if (generation.current !== run) return;
        const event = parseVoiceEvent(String(message.data));
        if (!event) return;
        if (event.t === "voice-settings") {
          settingsRef.current = event.settings;
        } else if (event.t === "ready") {
          ready = true;
          setState("active");
          voiceDiagnostic("ready", run, { state: "active" });
          heartbeat.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "heartbeat" }));
          }, 5_000);
        } else if (event.t === "partial") {
          setPartial(event.text);
        } else if (event.t === "transcript") {
          const receivedAt = performance.now();
          pendingTranscripts.current = Math.max(0, pendingTranscripts.current - 1);
          submission.current = submission.current
            .then(() => generation.current === run ? submitTranscript(event, receivedAt) : undefined)
            .catch(() => {
              if (generation.current !== run) return;
              setError(strings.lost);
              disconnect();
            });
          const queued = submission.current;
          void queued.then(() => {
            if (
              submission.current === queued &&
              generation.current === run &&
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
        if (generation.current !== run) return;
        if (!expectedClose.current && !stopping.current) setError(strings.lost);
        disconnect();
      };
      ws.onerror = () => ws.close();
    } catch (error) {
      const stale = generation.current !== run;
      voiceDiagnostic(stale ? "start-error-stale" : `${stage}-failed`, run, { errorType: voiceErrorType(error) });
      if (stale) return;
      setError(stage === "microphone" ? strings.permission : strings.startFailed);
      void disconnect();
    }
  }, [autoSubmit, closed, deviceId, disconnect, enabled, lang, langs, refreshDevices, speakerName, state, strings, submitTranscript, token, updateMeter]);

  return { state, partial, error, devices, deviceId, setDeviceId, start, stop, meter, phase };
}
