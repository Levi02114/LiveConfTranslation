"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { newBrowserId } from "@/lib/browser-id";
import { AudioTurnDetector } from "@/lib/audio-turn-detector";
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

type CompletedTranscript = { contentIndex: number; body: string };

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
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partials = useRef(new Map<string, string>());
  const commitsSent = useRef(0);
  const committedItems = useRef<string[]>([]);
  const completedItems = useRef(new Map<string, CompletedTranscript>());
  const nextSubmission = useRef(0);
  const submissionChain = useRef(Promise.resolve());
  const finalCommit = useRef<{ ordinal: number; release: boolean; itemId?: string } | null>(null);

  const endpoint = `/api/pages/${encodeURIComponent(token)}/realtime-session`;

  const disconnect = useCallback(
    (release = true) => {
      if (heartbeat.current) clearInterval(heartbeat.current);
      heartbeat.current = null;
      if (closingTimer.current) clearTimeout(closingTimer.current);
      closingTimer.current = null;
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
      commitsSent.current = 0;
      committedItems.current = [];
      completedItems.current.clear();
      nextSubmission.current = 0;
      submissionChain.current = Promise.resolve();
      finalCommit.current = null;
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
    clientId.current = newBrowserId();
    return () => disconnect();
  }, [disconnect]);

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
      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(token)}/transcripts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leaseId: sessionLease,
            ingestKey: `${clientId.current}:${itemId}:${contentIndex}`,
            body,
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
    [disconnect, strings.lost, token],
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
            submitTranscript(sessionLease, itemId, completed.contentIndex, completed.body),
          );
        }

        const finishing = finalCommit.current;
        if (finishing?.itemId === itemId) {
          finalCommit.current = null;
          void submissionChain.current.finally(() => disconnect(finishing.release));
        }
      }
    },
    [disconnect, submitTranscript],
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
      let event: TranscriptionEvent;
      try {
        event = JSON.parse(raw) as TranscriptionEvent;
      } catch {
        return;
      }

      const itemId = event.item_id;
      if (event.type === "input_audio_buffer.committed" && itemId) {
        committedItems.current.push(itemId);
        if (finalCommit.current?.ordinal === committedItems.current.length) {
          finalCommit.current.itemId = itemId;
        }
        flushTranscripts(sessionLease);
        return;
      }
      if (!itemId) return;
      if (event.type === "conversation.item.input_audio_transcription.delta") {
        partials.current.set(itemId, (partials.current.get(itemId) ?? "") + (event.delta ?? ""));
        setPartial([...partials.current.values()].join(" "));
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        partials.current.delete(itemId);
        setPartial([...partials.current.values()].join(" "));
        completedItems.current.set(itemId, {
          contentIndex: event.content_index ?? 0,
          body: event.transcript?.trim() ?? "",
        });
        flushTranscripts(sessionLease);
      }
    },
    [flushTranscripts],
  );

  const monitorSilence = useCallback(
    (media: MediaStream) => {
      const context = new AudioContext();
      void context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(media).connect(analyser);
      audioContext.current = context;

      const samples = new Float32Array(analyser.fftSize);
      const detector = new AudioTurnDetector();
      const measure = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        if (detector.update(Math.sqrt(sum / samples.length), performance.now())) sendCommit();
        audioFrame.current = requestAnimationFrame(measure);
      };
      measure();
    },
    [sendCommit],
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
      void audioContext.current?.close();
      audioContext.current = null;

      const ordinal = sendCommit();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (ordinal === null) {
        disconnect();
        return;
      }

      finalCommit.current = { ordinal, release: true };
      closingTimer.current = setTimeout(() => disconnect(), 5_000);
    },
    [disconnect, sendCommit],
  );

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
          disconnect(false);
        }
      }, 5_000);
      setState("active");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : strings.permission);
      disconnect();
    }
  }, [closed, deviceId, disconnect, endpoint, handleEvent, monitorSilence, refreshDevices, state, strings]);

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
