"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { retryAfterMilliseconds } from "@/hooks/use-submit-queue";
import { AudioTurnDetector } from "@/lib/audio-turn-detector";
import { newBrowserId } from "@/lib/browser-id";
import { parseMessageResponse, parseVoiceEvent, type VoiceEventPayload } from "@/lib/client-json";
import { voiceDiagnostic, voiceErrorType } from "@/lib/client-diagnostics";
import { releaseVoiceAudio } from "@/lib/voice-cleanup";
import type { UiStrings } from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";
import { NeuralTurnDetector } from "@/lib/neural-turn-detector";
import { SentenceJoiner, type JoinedSegment } from "@/lib/sentence-joiner";
import { DEFAULT_VOICE_SETTINGS, silenceMsFor, voiceSettingsSchema, type VoiceSettings } from "@/lib/voice-settings";
import {
  METER_INTERVAL_MS,
  VoiceMeterTracker,
  noiseGateRms,
  type VoiceMeter,
} from "@/lib/voice-level";

type VoiceState = "idle" | "starting" | "active" | "stopping";

type ServerVoiceInputOptions = {
  test?: { dry: boolean; provider: "openai" | "google" | "local"; settings: VoiceSettings;
    onSegment: (result: { body: string; lang?: LanguageCode; elapsedMs: number; silenceMs: number }) => void | Promise<void> };
  token: string;
  participantId?: string;
  strings: UiStrings["capture"];
  closed: boolean;
  speakerName?: string | null;
  onFallback?: (lang: LanguageCode) => void;
  langs: readonly LanguageCode[];
  automaticLanguage?: boolean;
  lang?: LanguageCode | null;
  enabled?: boolean;
  requestPermissionOnMount?: boolean;
  autoSubmit?: boolean;
  rewrite?: boolean;
  onTranscript?: (body: string) => void;
  /** 자동 전송한 확정 전사를 Zoom 채팅에도 보낼지(참가자 개별 설정). */
  zoomChat?: boolean;
  onZoomChatUnavailable?: () => void;
};

/** 마이크 대신 컴퓨터에서 나는 소리(Zoom 등 앱 소리)를 받는 가상 장치 값. */
export const SYSTEM_AUDIO_DEVICE = "lct-system-audio";

/** 데스크톱 브라우저만 화면 공유로 시스템 소리를 줄 수 있다. 휴대전화·태블릿은 숨긴다. */
function systemAudioSupported() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia) && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
}

/**
 * 시스템 소리만 남긴다. 화면 공유는 영상 없이 요청할 수 없어 받은 즉시 영상 트랙을 멈춘다.
 * 공유 창에서 "시스템 오디오 공유"를 끄면 소리 트랙이 없으므로 시작하지 않는다.
 */
async function captureSystemAudio() {
  const media = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    // 앱 소리를 그대로 받는다. 에코 제거·자동 음량은 회의 음성을 깎을 수 있다.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  media.getVideoTracks().forEach((track) => track.stop());
  const tracks = media.getAudioTracks();
  // macOS에서 시스템 오디오 녹음 권한이 없으면 오류 없이 이미 끝난 트랙이 온다.
  if (!tracks.length || tracks[0].readyState === "ended") {
    media.getTracks().forEach((track) => track.stop());
    throw new Error("system-audio-missing");
  }
  return new MediaStream(tracks);
}

export function useServerVoiceInput({
  token,
  participantId,
  strings,
  closed,
  speakerName,
  onFallback = () => {},
  langs,
  automaticLanguage = false,
  lang = null,
  enabled = true,
  requestPermissionOnMount = true,
  autoSubmit = true,
  rewrite = false,
  onTranscript,
  zoomChat = false,
  onZoomChatUnavailable,
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
  // 녹음 중에 바꿔도 다음 전사부터 적용되게 시작 시점의 값을 붙잡지 않는다.
  const zoomChatRef = useRef({ enabled: zoomChat, unavailable: onZoomChatUnavailable });
  useEffect(() => {
    zoomChatRef.current = { enabled: zoomChat, unavailable: onZoomChatUnavailable };
  }, [onZoomChatUnavailable, zoomChat]);
  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [tail, setTail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [systemAudio, setSystemAudio] = useState(false);
  // 마이크 권한과 무관하게 보인다. 서버 렌더와 맞추려고 마운트 뒤에 판단한다.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSystemAudio(systemAudioSupported()));
    return () => cancelAnimationFrame(frame);
  }, []);
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
  // 자동 저장은 문장 단위로 다시 묶는다. 꼬리는 다음 턴·말이 멈춤·중지 때 내보낸다.
  const joiner = useRef(new SentenceJoiner());
  const lastLease = useRef("");
  const lastTranscriptAt = useRef(0);
  const tailTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const postRef = useRef<(segment: JoinedSegment, leaseId: string) => Promise<Response>>(async () => Response.error());
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
      current && (current === SYSTEM_AUDIO_DEVICE || rows.some((device) => device.deviceId === current))
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
    if (tailTimer.current) clearInterval(tailTimer.current);
    tailTimer.current = null;
    // 오류로 끊길 때도 들고 있던 꼬리를 버리지 않도록 마지막으로 한 번 보낸다.
    const tail = joiner.current.flush();
    if (tail && lastLease.current) void postRef.current(tail, lastLease.current).catch(() => {});
    setTail("");
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
        await testRef.current.onSegment({ body: event.body, lang: event.lang, elapsedMs: commit ? receivedAt - commit.at : 0,
          silenceMs: commit?.silenceMs ?? 0 });
        return;
      }
      if (!event.body.trim()) return;
      if (!autoSubmit) {
        onTranscript?.(event.body);
        return;
      }
      lastLease.current = event.leaseId;
      lastTranscriptAt.current = Date.now();
      const segments = joiner.current.push(event.body, event.lang, `${event.itemId}:${event.contentIndex}`, Date.now(), event.replaceLastWord);
      setTail(joiner.current.peek());
      for (const segment of segments) await postRef.current(segment, event.leaseId);
      if (event.usedFallback) onFallback(event.lang);
    },
    [autoSubmit, onFallback, onTranscript],
  );

  const postTranscript = useCallback(
    async (segment: JoinedSegment, leaseId: string) => {
      const request = JSON.stringify({
        leaseId,
        ingestKey: `${clientId.current}:${segment.key}`,
        body: segment.text,
        lang: segment.lang,
        speakerName: speakerName || undefined,
        rewrite,
        zoomChat: zoomChatRef.current.enabled || undefined,
      });
      // 같은 ingestKey로 다시 보내므로 중복 저장되지 않는다. 일시 오류 한 번에 세션을 끊지 않는다.
      let response: Response | null = null;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await fetch(`/api/pages/${encodeURIComponent(token)}/transcripts`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: request,
          });
        } catch {
          response = null;
        }
        const transient = !response || response.status === 429 || response.status >= 500;
        if (!transient || attempt >= 3) break;
        const delay = Math.max(1_000 * 2 ** attempt, response ? retryAfterMilliseconds(response) : 0);
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 10_000)));
      }
      if (!response?.ok) throw new Error(strings.lost);
      if (parseMessageResponse(await response.clone().text().catch(() => ""))?.zoomChat === "unavailable") zoomChatRef.current.unavailable?.();
      return response;
    },
    [rewrite, speakerName, strings.lost, token],
  );
  useEffect(() => { postRef.current = postTranscript; }, [postTranscript]);

  /** 들고 있는 문장 꼬리를 저장 순서 큐 뒤에 붙여 보낸다. */
  const flushTail = useCallback(() => {
    submission.current = submission.current.then(async () => {
      const tail = joiner.current.flush();
      setTail("");
      if (tail && lastLease.current) await postRef.current(tail, lastLease.current);
    });
    return submission.current;
  }, []);

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
      void flushTail().catch(() => {}).finally(() => { void disconnect(); });
    }
  }, [disconnect, flushTail, releaseAudio, state]);
  // 시작 시점에 붙인 공유 종료 처리기도 최신 상태의 stop을 부르게 한다.
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);

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
      const system = deviceId === SYSTEM_AUDIO_DEVICE;
      if (deviceId && !system) audio.deviceId = { exact: deviceId };
      const media = system ? await captureSystemAudio() : await navigator.mediaDevices.getUserMedia({ audio });
      if (generation.current !== run) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      if (system) {
        // 브라우저의 "공유 중지"를 누르면 소리가 끊긴다. 받은 데까지 확정하고 멈춘다.
        media.getAudioTracks()[0].addEventListener("ended", () => {
          if (generation.current !== run) return;
          setError(strings.systemAudioEnded);
          stopRef.current(true);
        });
      }
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
      // Windows 일부 장치에서 resume()이 끝나지 않으면 "시작 중"에 갇힌다. 상한 뒤 시작 실패로 처리한다.
      if (audioContext.state !== "running") {
        await Promise.race([audioContext.resume(), new Promise((_, reject) => setTimeout(() => reject(new Error("resume-timeout")), 8_000))]);
      }
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
        ? `test=1&source=${encodeURIComponent(automaticLanguage ? "" : langs[0])}&provider=${testRef.current.provider}`
        : `token=${encodeURIComponent(token)}`;
      const ws = dry ? null : new WebSocket(`${scheme}://${window.location.host}/ws/transcribe?${query}&clientId=${encodeURIComponent(clientId.current)}`);
      socket.current = ws;
      if (ws) ws.binaryType = "arraybuffer";
      let turnSilenceMs = silenceMsFor(testRef.current?.settings ?? settingsRef.current, langs, automaticLanguage);
      const nextSilenceMs = () => (turnSilenceMs = silenceMsFor(testRef.current?.settings ?? settingsRef.current, langs, automaticLanguage));
      const nextMaxTurnMs = () => (testRef.current?.settings ?? settingsRef.current).maxTurnMs;
      const minRms = () => noiseGateRms((testRef.current?.settings ?? settingsRef.current).noiseGateLevel);
      const detector = new AudioTurnDetector(nextSilenceMs, nextMaxTurnMs, minRms);
      let ready = dry;
      if (dry) { setState("active"); voiceDiagnostic("ready", run, { state: "active" }); }
      let lastTurnAt = performance.now();

      const commitTurn = (forced = false) => {
        if (!ready || stopping.current || generation.current !== run) return;
        if (dry) void testRef.current?.onSegment({ body: "", elapsedMs: 0, silenceMs: turnSilenceMs });
        else {
          if (ws?.readyState !== WebSocket.OPEN) return;
          if (testRef.current) commits.current.push({ at: performance.now(), silenceMs: turnSilenceMs });
          // 강제 컷이면 서버가 끝 1초를 다음 턴 앞에 겹쳐 잘린 단어를 다시 듣는다.
          ws.send(JSON.stringify(forced ? { t: "commit", overlap: true } : { t: "commit" }));
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
        nextMaxTurnMs,
        minRms,
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
        if (rms > Math.max(0.0025, minRms())) speechSinceCommit.current = true;
        if (testRef.current) {
          const next = neuralVad.current?.phase() ?? detector.phase();
          setPhase((current) => next === "idle" && current === "committed" ? current : next);
        }
        if (neuralVad.current) return; // 커밋은 신경망 VAD 가 결정한다
        if (detector.update(rms, performance.now()) && speechSinceCommit.current) {
          commitTurn(detector.lastCutForced);
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
          joiner.current = new SentenceJoiner();
          // 말이 멈췄거나(2.5초 무음) 꼬리를 너무 오래 들고 있으면 문장이 안 끝났어도 내보낸다.
          tailTimer.current = setInterval(() => {
            if (generation.current !== run || stopping.current || pendingTranscripts.current || !joiner.current.holding()) return;
            if (Date.now() - lastTranscriptAt.current < (speechSinceCommit.current ? 25_000 : 2_500)) return;
            void flushTail().catch(() => {
              if (generation.current !== run) return;
              setError(strings.lost);
              void disconnect();
            });
          }, 1_000);
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
            ) void flushTail().catch(() => {}).finally(() => { void disconnect(); });
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
      setError(stage !== "microphone" ? strings.startFailed
        : deviceId === SYSTEM_AUDIO_DEVICE ? (/Mac/.test(navigator.userAgent) ? strings.systemAudioMac : strings.systemAudioMissing)
        : strings.permission);
      void disconnect();
    }
  }, [automaticLanguage, autoSubmit, closed, deviceId, disconnect, enabled, flushTail, lang, langs, refreshDevices, speakerName, state, strings, submitTranscript, token, updateMeter]);

  return { state, partial: tail && partial ? `${tail} ${partial}` : tail || partial, error, devices, deviceId, setDeviceId, systemAudio, start, stop, meter, phase };
}
