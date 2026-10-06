import { createHmac, timingSafeEqual } from "node:crypto";
import WebSocket from "ws";
import { z } from "zod";

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

const packetSchema = z.object({
  msg_type: z.number().int(), status_code: z.number().int().optional(), timestamp: z.number().optional(),
  state: z.number().optional(), reason: z.union([z.number(), z.string()]).optional(),
  media_server: z.object({ server_urls: z.object({ transcript: z.string() }) }).optional(),
  content: zoomTranscriptSchema.optional(),
});

/** Official RTMS WebSocket handshake. Only transcripts; never audio, video or chat. */
export function connectZoomRtms(input: {
  clientId: string; clientSecret: string; meeting: string; stream: string; url: string; sourceLanguage: number;
  transcript: (value: ZoomTranscript) => void;
  state: (value: "live" | "paused") => void;
  ended: (reason: string) => void;
}, connect = (url: string) => new WebSocket(url, { maxPayload: 64 * 1024, handshakeTimeout: 15000, followRedirects: false })) {
  let stopped = false;
  let media: WebSocket | undefined;
  let ready = false;
  let lastSignal = Date.now(), lastMedia = Date.now();
  const signature = createHmac("sha256", input.clientSecret).update(`${input.clientId},${input.meeting},${input.stream}`).digest("hex");
  const identity = { meeting_uuid: input.meeting, rtms_stream_id: input.stream, signature };
  const signaling = connect(zoomSocketUrl(input.url));
  const timer = setInterval(() => {
    if (!ready || Date.now() - Math.min(lastSignal, lastMedia) > 90000) finish("transportFailed");
  }, 30000);
  timer.unref?.();
  function stop() {
    if (stopped) return;
    stopped = true; clearInterval(timer);
    media?.terminate();
    if (signaling.readyState === WebSocket.OPEN) {
      // Explicitly end RTMS instead of letting a dead receiver keep a stream alive.
      const deadline = setTimeout(() => signaling.terminate(), 2000);
      deadline.unref?.();
      signaling.once("close", () => clearTimeout(deadline));
      signaling.send(JSON.stringify({ msg_type: 21, rtms_stream_id: input.stream }), () => signaling.close());
    } else signaling.terminate();
  }
  function finish(reason: string) {
    if (stopped) return;
    stop(); input.ended(reason);
  }
  function listen(socket: WebSocket, signalingChannel: boolean) {
    socket.on("error", () => finish("transportFailed"));
    socket.on("close", () => finish("transportFailed"));
    socket.on("message", (raw) => {
      if (stopped) return;
      try {
        const parsed = packetSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) { finish("transportFailed"); return; }
        const packet = parsed.data;
        if (signalingChannel) lastSignal = Date.now(); else lastMedia = Date.now();
        if (packet.msg_type === 12 && packet.timestamp !== undefined) {
          socket.send(JSON.stringify({ msg_type: 13, timestamp: packet.timestamp })); return;
        }
        if (signalingChannel && packet.msg_type === 2) {
          if (packet.status_code !== 0 || !packet.media_server || media) { finish("transportFailed"); return; }
          media = connect(zoomSocketUrl(packet.media_server.server_urls.transcript));
          listen(media, false);
          media.on("open", () => {
            if (!stopped) media!.send(JSON.stringify({ msg_type: 3, protocol_version: 1, sequence: 0, ...identity,
              media_type: 8, media_params: { transcript: { content_type: 5, src_language: input.sourceLanguage, enable_lid: true } } }));
          });
        } else if (!signalingChannel && packet.msg_type === 4) {
          if (packet.status_code !== 0) { finish("transportFailed"); return; }
          ready = true;
          signaling.send(JSON.stringify({ msg_type: 7, rtms_stream_id: input.stream }));
          input.state("live");
        } else if (!signalingChannel && packet.msg_type === 17 && ready && packet.content) {
          input.transcript(packet.content);
        } else if (signalingChannel && packet.msg_type === 8) {
          if ([3, 4].includes(packet.state ?? -1)) finish(packet.reason === 8 ? "revoked" : "streamStopped");
          else if (packet.state === 5) input.state("paused");
          else if (packet.state === 6) input.state("live");
        }
      } catch { finish("transportFailed"); }
    });
  }
  listen(signaling, true);
  signaling.on("open", () => {
    if (!stopped) signaling.send(JSON.stringify({ msg_type: 1, protocol_version: 1, sequence: 1, buffer_data: false, ...identity }));
  });
  return stop;
}
