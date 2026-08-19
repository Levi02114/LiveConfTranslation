"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AudioTurnDetector } from "@/lib/audio-turn-detector";
import { newBrowserId } from "@/lib/browser-id";
import type { UiStrings } from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";

type VoiceState = "idle" | "starting" | "active";
type VoiceEvent =
  | { t: "ready"; leaseId: string }
  | { t: "partial"; text: string }
  | {
      t: "transcript";
      itemId: string;
      contentIndex: number;
      body: string;
      lang: LanguageCode;
      usedFallback: boolean;
      leaseId: string;
    }
  | { t: "error"; reason: "busy" | "key-required" | "speaker-required" | "lost" };

export function useCombinedVoiceInput({
  token,
  strings,
  closed,
  speakerName,
  onFallback,
}: {
  token: string;
  strings: UiStrings["capture"];
  closed: boolean;
  speakerName?: string | null;
  onFallback: (lang: LanguageCode) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const clientId = useRef("");
  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopping = useRef(false);
  const expectedClose = useRef(false);
  const speechSinceCommit = useRef(false);
  const submission = useRef(Promise.resolve());

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
    expectedClose.current = true;
    socket.current?.close();
    socket.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void context.current?.close();
    context.current = null;
    setPartial("");
    setState("idle");
  }, []);

  useEffect(() => {
    clientId.current = newBrowserId();
    return disconnect;
  }, [disconnect]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
    let disposed = false;
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(async (media) => {
      media.getTracks().forEach((track) => track.stop());
      if (!disposed) await refreshDevices();
    }).catch(() => {
      // 자동 권한 요청을 브라우저가 막으면 시작 버튼에서 다시 요청한다.
    });
    return () => { disposed = true; };
  }, [refreshDevices]);

  const submitTranscript = useCallback(
    async (event: Extract<VoiceEvent, { t: "transcript" }>) => {
      const response = await fetch(`/api/pages/${encodeURIComponent(token)}/transcripts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseId: event.leaseId,
          ingestKey: `${clientId.current}:${event.itemId}:${event.contentIndex}`,
          body: event.body,
          lang: event.lang,
          speakerName: speakerName || undefined,
        }),
      });
      if (!response.ok) throw new Error(strings.lost);
      if (event.usedFallback) onFallback(event.lang);
      if (stopping.current) disconnect();
    },
    [disconnect, onFallback, speakerName, strings.lost, token],
  );

  const stop = useCallback(() => {
    if (state !== "active" || stopping.current) return;
    stopping.current = true;
    stream.current?.getTracks().forEach((track) => track.stop());
    if (speechSinceCommit.current && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ t: "commit" }));
      stopTimer.current = setTimeout(disconnect, 5_000);
    } else {
      disconnect();
    }
  }, [disconnect, state]);

  const start = useCallback(async () => {
    if (state !== "idle" || closed) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(strings.insecure);
      return;
    }
    setState("starting");
    setError(null);
    expectedClose.current = false;

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.current = media;
      void refreshDevices();

      const audioContext = new AudioContext();
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

      processor.port.onmessage = (message: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
        const { pcm, rms } = message.data;
        if (!ready || ws.readyState !== WebSocket.OPEN) {
          detector.calibrate(rms);
          return;
        }
        ws.send(pcm);
        if (rms > 0.0025) speechSinceCommit.current = true;
        if (detector.update(rms, performance.now()) && speechSinceCommit.current) {
          ws.send(JSON.stringify({ t: "commit" }));
          speechSinceCommit.current = false;
        }
      };

      ws.onopen = () => ws.send(JSON.stringify({ t: "start", speakerName: speakerName || undefined }));
      ws.onmessage = (message) => {
        let event: VoiceEvent;
        try {
          event = JSON.parse(String(message.data)) as VoiceEvent;
        } catch {
          return;
        }
        if (event.t === "ready") {
          ready = true;
          setState("active");
          heartbeat.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "heartbeat" }));
          }, 5_000);
        } else if (event.t === "partial") {
          setPartial(event.text);
        } else if (event.t === "transcript") {
          submission.current = submission.current
            .then(() => submitTranscript(event))
            .catch(() => {
              setError(strings.lost);
              disconnect();
            });
        } else if (event.t === "error") {
          setError(
            event.reason === "busy"
              ? strings.busy
              : event.reason === "key-required"
                ? strings.keyRequired
                : event.reason === "speaker-required"
                  ? strings.startFailed
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
  }, [closed, deviceId, disconnect, refreshDevices, speakerName, state, strings, submitTranscript, token]);

  return { state, partial, error, devices, deviceId, setDeviceId, start, stop };
}
