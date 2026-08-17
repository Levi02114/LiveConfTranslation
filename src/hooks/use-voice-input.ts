"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { newBrowserId } from "@/lib/browser-id";
import type { UiStrings } from "@/lib/i18n-builtin";

export type VoiceInputState = "idle" | "starting" | "active";

type RealtimeSession = {
  leaseId: string;
  clientSecret: string;
  realtimeUrl: string;
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
const SILENCE_MS = 1_300;

export function useVoiceInput({
  token,
  strings,
  closed,
  requestPermissionOnMount = false,
}: {
  token: string;
  strings: UiStrings["capture"];
  closed: boolean;
  requestPermissionOnMount?: boolean;
}) {
  const [state, setState] = useState<VoiceInputState>("idle");
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
      setState("idle");

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

  useEffect(() => {
    clientId.current = newBrowserId();
    return () => stop();
  }, [stop]);

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
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (!requestPermissionOnMount || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
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
  }, [refreshDevices, requestPermissionOnMount]);

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
      if (!response.ok) {
        setError(strings.lost);
        stop(false);
      }
    },
    [stop, strings.lost, token],
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

  const start = useCallback(async () => {
    if (state !== "idle" || closed) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(strings.insecure);
      return;
    }

    setState("starting");
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
        throw new Error(strings.permission);
      }
      await refreshDevices();

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: clientId.current }),
      });
      const session = (await response.json().catch(() => null)) as RealtimeSession | null;
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
      if (!answer.ok) throw new Error(strings.lost);
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
          setError(strings.lost);
          stop(false);
        }
      }, 5_000);
      setState("active");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : strings.permission);
      stop();
    }
  }, [closed, deviceId, endpoint, handleEvent, monitorSilence, refreshDevices, state, stop, strings]);

  return {
    state,
    partial,
    error,
    devices,
    deviceId,
    setDeviceId,
    start,
    stop,
  };
}
