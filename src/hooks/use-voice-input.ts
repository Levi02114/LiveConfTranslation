"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AudioTurnDetector } from "@/lib/audio-turn-detector";
import { newBrowserId } from "@/lib/browser-id";
import { useServerVoiceInput } from "@/hooks/use-combined-voice-input";
import { parseRealtimeSession, parseTranscriptionEvent } from "@/lib/client-json";
import type { UiStrings } from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";
import { NeuralTurnDetector, redemptionMsFor } from "@/lib/neural-turn-detector";
import { singleTranscriptionProfile } from "@/lib/transcription-profile";
import {
  METER_INTERVAL_MS,
  VoiceMeterTracker,
  type VoiceMeter,
} from "@/lib/voice-level";

export type VoiceInputState = "idle" | "starting" | "active";

type CompletedTranscript = { contentIndex: number; body: string };
const PARTIAL_INTERVAL_MS = 50;
const AUDIO_ANALYSIS_INTERVAL_MS = 50;

export function useVoiceInput({
  token,
  participantId,
  strings,
  closed,
  autoSubmit = true,
  rewrite = false,
  speakerName,
  onTranscript,
  requestPermissionOnMount = false,
  lang,
  forceServerTransport = false,
}: {
  token: string;
  participantId?: string;
  strings: UiStrings["capture"];
  closed: boolean;
  autoSubmit?: boolean;
  rewrite?: boolean;
  speakerName?: string | null;
  onTranscript?: (body: string) => void;
  requestPermissionOnMount?: boolean;
  /** VAD 무음 관용을 언어별로 맞춘다(타이어·싱할라어는 더 길게). */
  lang?: LanguageCode;
  /** 로컬 whisper.cpp는 모든 언어가 서버 WebSocket 경로를 쓴다. */
  forceServerTransport?: boolean;
}) {
  const serverTransport = Boolean(
    forceServerTransport || (lang && singleTranscriptionProfile(lang).transport === "websocket"),
  );
  const serverVoice = useServerVoiceInput({
    token,
    participantId,
    strings,
    closed,
    autoSubmit,
    rewrite,
    speakerName,
    onTranscript,
    langs: lang ? [lang] : [],
    enabled: serverTransport,
    requestPermissionOnMount,
  });
  const [state, setState] = useState<VoiceInputState>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [meter, setMeter] = useState<VoiceMeter | null>(null);

  const clientId = useRef("");
  const leaseId = useRef<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioFrame = useRef<number | null>(null);
  const neuralVad = useRef<NeuralTurnDetector | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partials = useRef(new Map<string, string>());
  const commitsSent = useRef(0);
  const committedItems = useRef<string[]>([]);
  const completedItems = useRef(new Map<string, CompletedTranscript>());
  const nextSubmission = useRef(0);
  const submissionChain = useRef(Promise.resolve());
  const finalCommit = useRef<{ ordinal: number; release: boolean; itemId?: string } | null>(null);
  const speechSinceCommit = useRef(false);
  const meterLastSet = useRef(0);
  const meterPeak = useRef(0);
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partialText = useRef("");

  const renderPartial = useCallback((value: string, immediate = false) => {
    partialText.current = value;
    if (immediate) {
      if (partialTimer.current) clearTimeout(partialTimer.current);
      partialTimer.current = null;
      setPartial(value);
      return;
    }
    if (partialTimer.current) return;
    partialTimer.current = setTimeout(() => {
      partialTimer.current = null;
      setPartial(partialText.current);
    }, PARTIAL_INTERVAL_MS);
  }, []);

  // 음량 미터는 100ms 간격으로만 상태를 갱신해 불필요한 리렌더를 막는다.
  const updateMeter = useCallback((tracker: VoiceMeterTracker, rms: number, peak: number) => {
    const now = performance.now();
    meterPeak.current = Math.max(meterPeak.current, peak);
    if (now - meterLastSet.current < METER_INTERVAL_MS) return;
    meterLastSet.current = now;
    setMeter(tracker.update(rms, meterPeak.current, now));
    meterPeak.current = 0;
  }, []);

  const endpoint = `/api/pages/${encodeURIComponent(token)}/realtime-session`;

  const disconnect = useCallback(
    (release = true) => {
      if (heartbeat.current) clearInterval(heartbeat.current);
      heartbeat.current = null;
      if (closingTimer.current) clearTimeout(closingTimer.current);
      closingTimer.current = null;
      if (partialTimer.current) clearTimeout(partialTimer.current);
      partialTimer.current = null;
      partialText.current = "";
      if (audioFrame.current !== null) cancelAnimationFrame(audioFrame.current);
      audioFrame.current = null;
      void neuralVad.current?.destroy();
      neuralVad.current = null;
      void audioContext.current?.close();
      audioContext.current = null;
      channel.current?.close();
      peer.current?.close();
      stream.current?.getTracks().forEach((track) => track.stop());
      channel.current = null;
      peer.current = null;
      stream.current = null;
      partials.current.clear();
      commitsSent.current = 0;
      committedItems.current = [];
      completedItems.current.clear();
      nextSubmission.current = 0;
      submissionChain.current = Promise.resolve();
      finalCommit.current = null;
      speechSinceCommit.current = false;
      setMeter(null);
      setPartial("");
      setState("idle");

      const currentLease = leaseId.current;
      leaseId.current = null;
      if (release && currentLease) {
        void fetch(endpoint, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseId: currentLease }),
          keepalive: true,
        }).catch(() => undefined);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    if (serverTransport) return;
    clientId.current = participantId || newBrowserId();
    return () => disconnect();
  }, [disconnect, participantId, serverTransport]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
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
    if (serverTransport || !navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices, serverTransport]);

  useEffect(() => {
    if (
      serverTransport ||
      !requestPermissionOnMount ||
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return;
    }
    let cancelled = false;
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(async (media) => {
        media.getTracks().forEach((track) => track.stop());
        if (!cancelled) await refreshDevices();
      })
      .catch(() => {
        // 자동 권한 요청이 제한되면 사용자가 토글을 켤 때 다시 요청한다.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshDevices, requestPermissionOnMount, serverTransport]);

  const deliverTranscript = useCallback(
    async (sessionLease: string, itemId: string, contentIndex: number, body: string) => {
      if (!autoSubmit) {
        onTranscript?.(body);
        return;
      }

      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(token)}/transcripts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leaseId: sessionLease,
            ingestKey: `${clientId.current}:${itemId}:${contentIndex}`,
            body,
            speakerName: speakerName || undefined,
            rewrite,
          }),
        });
        if (response.ok) return;
      } catch {
        // 아래의 연결 종료 경로에서 동일하게 처리한다.
      }
      if (leaseId.current) {
        setError(strings.lost);
        disconnect(false);
      }
    },
    [autoSubmit, disconnect, onTranscript, rewrite, speakerName, strings.lost, token],
  );

  const flushTranscripts = useCallback(
    (sessionLease: string) => {
      while (nextSubmission.current < committedItems.current.length) {
        const itemId = committedItems.current[nextSubmission.current];
        const completed = completedItems.current.get(itemId);
        if (!completed) break;

        nextSubmission.current += 1;
        completedItems.current.delete(itemId);
        if (completed.body) {
          submissionChain.current = submissionChain.current.then(() =>
            deliverTranscript(sessionLease, itemId, completed.contentIndex, completed.body),
          );
        }

        const finishing = finalCommit.current;
        if (finishing?.itemId === itemId) {
          finalCommit.current = null;
          void submissionChain.current.finally(() => disconnect(finishing.release));
        }
      }
    },
    [deliverTranscript, disconnect],
  );

  const sendCommit = useCallback(() => {
    const current = channel.current;
    if (current?.readyState !== "open") return null;
    current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    commitsSent.current += 1;
    return commitsSent.current;
  }, []);

  const handleEvent = useCallback(
    (raw: string, sessionLease: string) => {
      const event = parseTranscriptionEvent(raw);
      if (!event) return;

      const itemId = event.itemId;
      if (event.type === "input_audio_buffer.committed" && itemId) {
        committedItems.current.push(itemId);
        if (finalCommit.current?.ordinal === committedItems.current.length) {
          finalCommit.current.itemId = itemId;
        }
        flushTranscripts(sessionLease);
        return;
      }
      if (event.type === "error" && finalCommit.current) {
        const finishing = finalCommit.current;
        finalCommit.current = null;
        void submissionChain.current.finally(() => disconnect(finishing.release));
        return;
      }
      if (!itemId) return;
      if (event.type === "conversation.item.input_audio_transcription.delta") {
        partials.current.set(itemId, (partials.current.get(itemId) ?? "") + (event.delta ?? ""));
        renderPartial([...partials.current.values()].join(" "));
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        partials.current.delete(itemId);
        renderPartial([...partials.current.values()].join(" "), true);
        completedItems.current.set(itemId, {
          contentIndex: event.contentIndex ?? 0,
          body: event.transcript?.trim() ?? "",
        });
        flushTranscripts(sessionLease);
      }
    },
    [disconnect, flushTranscripts, renderPartial],
  );

  const monitorSilence = useCallback(
    async (media: MediaStream) => {
      // VAD와 음량 미터가 같은 오디오 그래프를 공유한다. 각각 AudioContext를
      // 만들면 휴대전화에서 같은 마이크를 두 번 처리하게 된다.
      const context = new AudioContext();
      audioContext.current = context;
      if (context.state !== "running") await context.resume();

      // 신경망 VAD 는 백그라운드에서 로드한다 — 기다리는 동안 RMS 감지기가 커밋을
      // 맡고, 로드가 끝나면 그때부터 신경망이 이어받는다(통합 입력과 같은 방식).
      void NeuralTurnDetector.create(
        media,
        () => {
          if (channel.current?.readyState === "open") {
            sendCommit();
            speechSinceCommit.current = false;
          }
        },
        { redemptionMs: redemptionMsFor(lang ? [lang] : []), audioContext: context },
      ).then((vad) => {
        // 로드가 끝나기 전에 세션이 닫혔으면 붙이지 않고 바로 버린다.
        if (vad && stream.current === media) neuralVad.current = vad;
        else void vad?.destroy();
      });

      // 음량 미터는 VAD 경로와 무관하게 항상 단다.
      // 커밋 판정(RMS 감지기)은 신경망이 아직 없을 때만 돌린다.
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(media).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const detector = new AudioTurnDetector();
      const tracker = new VoiceMeterTracker();
      let lastMeasurement = 0;
      const measure = (now: number) => {
        if (now - lastMeasurement < AUDIO_ANALYSIS_INTERVAL_MS) {
          audioFrame.current = requestAnimationFrame(measure);
          return;
        }
        lastMeasurement = now;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        let peak = 0;
        for (const sample of samples) {
          sum += sample * sample;
          const abs = sample < 0 ? -sample : sample;
          if (abs > peak) peak = abs;
        }
        const level = Math.sqrt(sum / samples.length);
        if (level > 0.0025) speechSinceCommit.current = true;
        if (!neuralVad.current) {
          if (channel.current?.readyState !== "open") detector.calibrate(level);
          else if (detector.update(level, performance.now()) && speechSinceCommit.current) {
            sendCommit();
            speechSinceCommit.current = false;
          }
        }
        updateMeter(tracker, level, peak);
        audioFrame.current = requestAnimationFrame(measure);
      };
      audioFrame.current = requestAnimationFrame(measure);
    },
    [lang, sendCommit, updateMeter],
  );

  const stop = useCallback(
    (flush = true) => {
      if (!flush) {
        disconnect();
        return;
      }
      if (finalCommit.current) return;

      if (audioFrame.current !== null) cancelAnimationFrame(audioFrame.current);
      audioFrame.current = null;
      void neuralVad.current?.destroy();
      neuralVad.current = null;
      void audioContext.current?.close();
      audioContext.current = null;
      setMeter(null);
      stream.current?.getTracks().forEach((track) => track.stop());

      if (!speechSinceCommit.current) {
        const ordinal = commitsSent.current;
        if (!ordinal || nextSubmission.current >= ordinal) {
          disconnect();
          return;
        }
        const itemId = committedItems.current[ordinal - 1];
        finalCommit.current = { ordinal, release: true, itemId };
        if (itemId && leaseId.current) flushTranscripts(leaseId.current);
        closingTimer.current = setTimeout(() => disconnect(), 5_000);
        return;
      }

      const ordinal = sendCommit();
      speechSinceCommit.current = false;
      if (ordinal === null) {
        disconnect();
        return;
      }

      finalCommit.current = { ordinal, release: true };
      closingTimer.current = setTimeout(() => disconnect(), 5_000);
    },
    [disconnect, flushTranscripts, sendCommit],
  );

  const start = useCallback(async () => {
    if (serverTransport || state !== "idle" || closed) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(strings.insecure);
      return;
    }

    setState("starting");
    setError(null);
    const sessionRequest = fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: clientId.current,
        speakerName: speakerName || undefined,
        autoSubmit,
      }),
    }).then(async (response) => {
      return { response, session: parseRealtimeSession(await response.text()) };
    });
    try {
      try {
        const audio: MediaTrackConstraints = {
          echoCancellation: true,
          // 서버 측 noise_reduction 과 이중 처리되면 자음이 뭉개져 전사가
          // 나빠진다. 브라우저 노이즈 억제는 끄고 서버에 맡긴다.
          noiseSuppression: false,
          autoGainControl: true,
        };
        if (deviceId) audio.deviceId = { exact: deviceId };
        stream.current = await navigator.mediaDevices.getUserMedia({ audio });
      } catch {
        throw new Error(strings.permission);
      }
      void refreshDevices();
      await monitorSilence(stream.current);

      const { response, session } = await sessionRequest;
      if (!response.ok || !session?.leaseId || !session.clientSecret) {
        throw new Error(
          response.status === 409
            ? strings.busy
            : response.status === 412
              ? strings.keyRequired
              : strings.startFailed,
        );
      }
      leaseId.current = session.leaseId;

      const connection = new RTCPeerConnection();
      peer.current = connection;
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "failed") {
          setError(strings.lost);
          disconnect();
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
      if (!answer.ok) throw new Error(strings.lost);
      await connection.setRemoteDescription({ type: "answer", sdp: await answer.text() });

      heartbeat.current = setInterval(async () => {
        const currentLease = leaseId.current;
        if (!currentLease) return;
        const renewed = await fetch(endpoint, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseId: currentLease }),
        }).catch(() => null);
        if (!renewed?.ok) {
          setError(strings.lost);
          disconnect(false);
        }
      }, 5_000);
      setState("active");
    } catch (cause) {
      if (!leaseId.current) {
        void sessionRequest
          .then(({ session }) => {
            if (!session?.leaseId) return;
            return fetch(endpoint, {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ leaseId: session.leaseId }),
            });
          })
          .catch(() => undefined);
      }
      setError(cause instanceof Error && cause.message ? cause.message : strings.permission);
      disconnect();
    }
  }, [autoSubmit, closed, deviceId, disconnect, endpoint, handleEvent, monitorSilence, refreshDevices, serverTransport, speakerName, state, strings]);

  const webRtcVoice = {
    state,
    partial,
    error,
    devices,
    deviceId,
    setDeviceId,
    start,
    stop,
    meter,
  };
  return serverTransport ? serverVoice : webRtcVoice;
}
