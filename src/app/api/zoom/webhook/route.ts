import { createHmac } from "node:crypto";
import { log } from "@/lib/diagnostics";
import { readZoomCredentials } from "@/lib/zoom";
import { verifyZoomWebhook, zoomWebhookSchema } from "@/lib/zoom-rtms";

export async function POST(request: Request) {
  const credentials = readZoomCredentials();
  if (!credentials?.webhookSecret) return new Response(null, { status: 503 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 65536) return new Response(null, { status: 413 });
  if (!verifyZoomWebhook(body, request.headers.get("x-zm-request-timestamp"), request.headers.get("x-zm-signature"), credentials.webhookSecret)) {
    log("warn", "zoom.webhook-rejected");
    return new Response(null, { status: 401 });
  }
  let event;
  try { event = zoomWebhookSchema.safeParse(JSON.parse(body)); } catch { return new Response(null, { status: 400 }); }
  // 서명이 맞는 다른 이벤트(meeting.rtms_interrupted 등)는 받기만 한다. 4xx는 Zoom 구독 상태를 나쁘게 만든다.
  if (!event.success) { log("info", "zoom.webhook-ignored", { reason: "unsupportedEvent" }); return new Response(null, { status: 204 }); }
  if (event.data.event === "endpoint.url_validation") {
    const plainToken = event.data.payload.plainToken;
    return Response.json({ plainToken, encryptedToken: createHmac("sha256", credentials.webhookSecret).update(plainToken).digest("hex") });
  }
  globalThis.__zoomRelay?.handleWebhook(event.data, credentials);
  return new Response(null, { status: 204 });
}
