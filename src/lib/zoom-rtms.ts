import { createHmac, timingSafeEqual } from "node:crypto";
import WebSocket from "ws";
import { z } from "zod";
import { log } from "./diagnostics";

export function verifyZoomWebhook(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!secret || !timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export const zoomWebhookSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("endpoint.url_validation"), payload: z.object({ plainToken: z.string().min(1).max(1024) }) }),
  z.object({ event: z.literal("meeting.rtms_started"), event_ts: z.number(), payload: z.object({
    meeting_uuid: z.string().min(1).max(256), rtms_stream_id: z.string().min(1).max(256), server_urls: z.string().max(4096),
  }) }),
  z.object({ event: z.literal("meeting.rtms_stopped"), event_ts: z.number(), payload: z.object({
    meeting_uuid: z.string().min(1).max(256), rtms_stream_id: z.string().min(1).max(256), stop_reason: z.number().int(),
  }) }),
]);

export type ZoomWebhookEvent = z.infer<typeof zoomWebhookSchema>;

export const zoomTranscriptSchema = z.object({
  user_id: z.number().int(), user_name: z.string().max(256), timestamp: z.number().nonnegative(),
  start_time: z.number().nonnegative().optional(), end_time: z.number().nonnegative().optional(),
  language: z.number().int(), data: z.string().trim().min(1).max(12000),
});
export type ZoomTranscript = z.infer<typeof zoomTranscriptSchema>;

// Do not turn a webhook (or a compromised upstream response) into an arbitrary socket proxy.
export function zoomSocketUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "wss:" || url.username || url.password || url.hash || (url.port && url.port !== "443") ||
      !["zoom.us", "zoom.com"].some((domain) => url.hostname.endsWith(`.${domain}`))) throw new Error("transportFailed");
  return url.href;
}

/** `server_urls` may list several comma-separated endpoints; use the first allowed WebSocket one. */
export function firstZoomSocketUrl(value: string): string {
  for (const candidate of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    try { return zoomSocketUrl(candidate); } catch { /* try the next listed endpoint */ }
  }
  throw new Error("transportFailed");
}

export const zoomAudioSchema = z.object({
  user_id: z.number().int(), user_name: z.string().max(256).optional(),
  timestamp: z.number().nonnegative().optional(), data: z.string().min(1).max(400_000),
});
export type ZoomAudio = { userId: number; userName: string; pcm: Buffer };

const packetSchema = z.object({
  msg_type: z.number().int(), status_code: z.number().int().optional(), timestamp: z.number().optional(),
  state: z.number().optional(), reason: z.union([z.number(), z.string()]).optional(),
  media_server: z.object({ server_urls: z.object({ audio: z.string().optional(), transcript: z.string().optional(), all: z.string().optional() }) }).optional(),
  content: z.unknown().optional(),
});

/** Zoom keeps a dropped stream for about a minute; reconnect within that window before giving up. */
const RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000, 15_000];

/**
 * Official RTMS WebSocket handshake. Receives either Zoom's own transcript or raw L16 audio
 * (16 kHz mono, mixed or one stream per participant); never video or chat.
 */
export function connectZoomRtms(input: {
  clientId: string; clientSecret: string; meeting: string; stream: string; url: string;
  sourceLanguage?: number;
  transcript?: (value: ZoomTranscript) => void;
  audio?: { streams: "multi" | "mixed"; receive: (value: ZoomAudio) => void };
  state: (value: "live" | "paused" | "connecting") => void;
  ended: (reason: string) => void;
}, connect = (url: string) => new WebSocket(url, { maxPayload: 512 * 1024, handshakeTimeout: 15000, followRedirects: false })) {
  let stopped = false;
  let url = input.url;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let current: { signaling: WebSocket; media?: WebSocket; ready: boolean; lastSignal: number; lastMedia: number } | null = null;
  const signature = createHmac("sha256", input.clientSecret).update(`${input.clientId},${input.meeting},${input.stream}`).digest("hex");
  const identity = { meeting_uuid: input.meeting, rtms_stream_id: input.stream, signature };
  const timer = setInterval(() => {
    if (current && (!current.ready || Date.now() - Math.min(current.lastSignal, current.lastMedia) > 65000)) drop("keepalive", 0);
  }, 30000);
  timer.unref?.();

  function closeCurrent() {
    const value = current;
    current = null;
    value?.media?.terminate();
    value?.signaling.terminate();
  }
  function stop() {
    if (stopped) return;
    stopped = true; clearInterval(timer); clearTimeout(retry);
    const value = current;
    current = null;
    value?.media?.terminate();
    if (value && value.signaling.readyState === WebSocket.OPEN) {
      // Explicitly end RTMS instead of letting a dead receiver keep a stream alive.
      const deadline = setTimeout(() => value.signaling.terminate(), 2000);
      deadline.unref?.();
      value.signaling.once("close", () => clearTimeout(deadline));
      value.signaling.send(JSON.stringify({ msg_type: 21, rtms_stream_id: input.stream }), () => value.signaling.close());
    } else value?.signaling.terminate();
  }
  function finish(reason: string) {
    if (stopped) return;
    stop(); input.ended(reason);
  }
  /** A transport failure (not a Zoom stop) reconnects with the same stream identity. */
  function drop(phase: string, code: number) {
    if (stopped || !current) return;
    log("warn", "zoom.rtms-drop", { phase, status: code, attempt });
    closeCurrent();
    const delay = RECONNECT_DELAYS_MS[attempt++];
    if (delay === undefined) { finish("transportFailed"); return; }
    input.state("connecting");
    retry = setTimeout(open, delay);
    retry.unref?.();
  }
  function listen(connection: NonNullable<typeof current>, socket: WebSocket, signalingChannel: boolean) {
    const phase = signalingChannel ? "signaling" : "media";
    socket.on("error", () => { if (current === connection) drop(phase, 0); });
    socket.on("close", (code) => { if (current === connection) drop(phase, code); });
    socket.on("message", (raw) => {
      if (stopped || current !== connection) return;
      let packet: z.infer<typeof packetSchema>;
      try {
        const parsed = packetSchema.safeParse(JSON.parse(raw.toString()));
        // One malformed packet must not end the whole meeting relay.
        if (!parsed.success) { log("warn", "zoom.rtms-packet-ignored", { phase }); return; }
        packet = parsed.data;
      } catch { log("warn", "zoom.rtms-packet-ignored", { phase }); return; }
      if (signalingChannel) connection.lastSignal = Date.now(); else connection.lastMedia = Date.now();
      if (packet.msg_type === 12 && packet.timestamp !== undefined) {
        socket.send(JSON.stringify({ msg_type: 13, timestamp: packet.timestamp })); return;
      }
      if (signalingChannel && packet.msg_type === 2) {
        const urls = packet.media_server?.server_urls;
        const mediaUrl = input.audio ? urls?.audio ?? urls?.all : urls?.transcript ?? urls?.all;
        if (packet.status_code !== 0 || !mediaUrl || connection.media) {
          log("warn", "zoom.rtms-handshake-failed", { phase, status: packet.status_code ?? -1 });
          finish("transportFailed"); return;
        }
        let media: WebSocket;
        try { media = connect(firstZoomSocketUrl(mediaUrl)); } catch { finish("transportFailed"); return; }
        connection.media = media;
        listen(connection, media, false);
        media.on("open", () => {
          if (stopped || current !== connection) return;
          media.send(JSON.stringify({ msg_type: 3, protocol_version: 1, sequence: 0, ...identity, payload_encryption: false,
            ...(input.audio
              ? { media_type: 1, media_params: { audio: { content_type: 2, sample_rate: 1, channel: 1, codec: 1,
                  data_opt: input.audio.streams === "multi" ? 2 : 1, send_rate: 100 } } }
              : { media_type: 8, media_params: { transcript: { content_type: 5, src_language: input.sourceLanguage ?? 9, enable_lid: true } } }) }));
        });
      } else if (!signalingChannel && packet.msg_type === 4) {
        if (packet.status_code !== 0) {
          log("warn", "zoom.rtms-handshake-failed", { phase, status: packet.status_code ?? -1 });
          finish("transportFailed"); return;
        }
        connection.ready = true;
        attempt = 0;
        connection.signaling.send(JSON.stringify({ msg_type: 7, rtms_stream_id: input.stream }));
        input.state("live");
      } else if (!signalingChannel && packet.msg_type === 17 && connection.ready && input.transcript) {
        const value = zoomTranscriptSchema.safeParse(packet.content);
        if (value.success) input.transcript(value.data);
        else log("warn", "zoom.rtms-packet-ignored", { phase });
      } else if (!signalingChannel && packet.msg_type === 14 && connection.ready && input.audio) {
        const value = zoomAudioSchema.safeParse(packet.content);
        if (!value.success) { log("warn", "zoom.rtms-packet-ignored", { phase }); return; }
        input.audio.receive({ userId: value.data.user_id, userName: value.data.user_name?.trim() ?? "", pcm: Buffer.from(value.data.data, "base64") });
      } else if (signalingChannel && packet.msg_type === 8) {
        if ([3, 4].includes(packet.state ?? -1)) finish(packet.reason === 8 ? "revoked" : "streamStopped");
        else if (packet.state === 5) input.state("paused");
        else if (packet.state === 6) input.state("live");
      }
    });
  }
  function open() {
    if (stopped) return;
    let signaling: WebSocket;
    try { signaling = connect(firstZoomSocketUrl(url)); } catch { finish("transportFailed"); return; }
    const connection = { signaling, ready: false, lastSignal: Date.now(), lastMedia: Date.now() };
    current = connection;
    listen(connection, signaling, true);
    signaling.on("open", () => {
      if (!stopped && current === connection) signaling.send(JSON.stringify({ msg_type: 1, protocol_version: 1, sequence: 1, buffer_data: false, ...identity }));
    });
  }
  open();
  return {
    stop,
    /** Zoom signals failover by repeating `rtms_started` for the same stream with new server URLs. */
    reconnect(next: string) {
      if (stopped) return;
      url = next; attempt = 0; clearTimeout(retry);
      closeCurrent();
      input.state("connecting");
      open();
    },
  };
}
