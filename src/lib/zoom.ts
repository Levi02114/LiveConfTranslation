import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "./crypto";
import { log } from "./diagnostics";
import { createMeeting, getMeeting, getMeetingActiveLangs, getMeetingPages, getMessageTranslations, getZoomMeeting,
  getZoomSettings, hasLanguage, InputError, setZoomSettings, touchEngineSetting, translationJobMessage, type Meeting, type Message } from "./repo";
import { getEngine } from "./translate";
import { resolveOpenaiModel } from "./secrets";
import { acceptMessage } from "./pipeline";
import { publishJobCounts, wakeTranslationWorker } from "./translation-worker";
import { zoomChatChunks, zoomCredentialsSchema, zoomLanguageId, ZOOM_LANGUAGES, type ZoomStart, type ZoomStatus } from "./zoom-contract";
import { connectZoomRtms, type ZoomTranscript, type zoomWebhookSchema } from "./zoom-rtms";

export function readZoomCredentials() {
  const stored = getZoomSettings();
  if (!stored) return null;
  const plain = decryptSecret(Buffer.from(stored, "base64"));
  if (!plain) return null;
  try {
    const parsed = zoomCredentialsSchema.safeParse(JSON.parse(plain));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function zoomSettingsStatus() {
  const credentials = readZoomCredentials();
  return { clientId: credentials?.clientId ?? "", hasClientSecret: Boolean(credentials?.clientSecret),
    hasWebhookSecret: Boolean(credentials?.webhookSecret),
    configured: Boolean(credentials?.clientId && credentials.clientSecret && credentials.webhookSecret),
    active: Boolean(globalThis.__zoomRelay?.active) };
}

export function saveZoomCredentials(value: z.infer<typeof zoomCredentialsSchema>) {
  if (globalThis.__zoomRelay?.active) throw new Error("busy");
  const old = readZoomCredentials();
  if (old && old.clientId !== value.clientId && (!value.clientSecret || !value.webhookSecret)) throw new Error("notConfigured");
  const next = { ...value, clientSecret: value.clientSecret || old?.clientSecret || "", webhookSecret: value.webhookSecret || old?.webhookSecret || "" };
  if (!next.clientSecret || !next.webhookSecret) throw new Error("notConfigured");
  setZoomSettings(Buffer.from(encryptSecret(JSON.stringify(next))).toString("base64"));
  log("info", "zoom.settings-saved");
}

/** Durable session input; chat delivery remains scoped to one live operator connection. */
export class ZoomRelay {
  readonly startedAt = Date.now();
  private lastPoll = Date.now();
  private state: ZoomStatus["state"] = "waiting";
  private error: string | null = null;
  private received = 0;
  private sent = 0;
  private sequence = 0;
  private lastAck = 0;
  private offered = 0;
  private stream = "";
  private inputs: Message[] = [];
  private outputs: NonNullable<ZoomStatus["next"]>[] = [];
  private closeStream?: () => void;
  private timer: ReturnType<typeof setInterval>;

  constructor(readonly input: ZoomStart, readonly meeting: Meeting) {
    this.timer = setInterval(() => this.checkLease(), 5000);
    this.timer.unref?.();
    log("info", "zoom.relay-start", { meetingId: meeting.id, count: input.targets.length });
  }

  get active() { return !["stopped", "error"].includes(this.state); }

  checkLease(now = Date.now()) {
    if (!this.active) return;
    if (getMeeting(this.meeting.id)?.status !== "open") this.stop("invalidSession");
    else if (JSON.stringify(getMeetingActiveLangs(this.meeting.id).sort()) !== JSON.stringify([...this.input.targets].sort())) this.stop("sessionSettingsMismatch");
    else if (now - this.lastPoll > 30000) this.stop("leaseExpired");
    else if (this.state === "waiting" && now - this.startedAt > 60000) this.stop("webhookTimeout");
  }

  poll(ack?: number): ZoomStatus {
    this.checkLease();
    this.lastPoll = Date.now();
    if (this.active && ack !== undefined && ack > this.lastAck) {
      if (ack !== this.outputs[0]?.sequence || ack !== this.offered) throw new Error("requestFailed");
      this.outputs.shift(); this.lastAck = ack; this.sent++;
      log("info", "zoom.chat-ack", { meetingId: this.meeting.id, count: this.sent });
    }
    if (this.active) this.drain();
    const next = this.active ? this.outputs[0] ?? null : null;
    if (next) this.offered = next.sequence;
    const viewer = getMeetingPages(this.meeting.id).find((page) => page.kind === "combined");
    return { session: { id: this.meeting.id, title: this.meeting.title, viewerPath: viewer ? `/all/${viewer.token}` : "" },
      state: this.state, error: this.error, received: this.received, sent: this.sent,
      pending: this.active ? this.inputs.length + this.outputs.length : 0, next };
  }

  stop(reason?: string) {
    if (!this.active) return;
    this.state = reason && reason !== "streamStopped" ? "error" : "stopped";
    this.error = reason ?? null;
    clearInterval(this.timer);
    this.closeStream?.(); this.closeStream = undefined;
    this.inputs = []; this.outputs = [];
    log(reason ? "warn" : "info", "zoom.relay-stop", { meetingId: this.meeting.id, reason: reason ?? "requested", count: this.received });
  }

  handleWebhook(event: z.infer<typeof zoomWebhookSchema>, credentials: NonNullable<ReturnType<typeof readZoomCredentials>>) {
    if (!this.active || event.event === "endpoint.url_validation" || event.payload.meeting_uuid !== this.input.zoomMeeting || event.event_ts < this.startedAt - 5000) return;
    this.checkLease();
    if (!this.active) return;
    if (event.event === "meeting.rtms_stopped") {
      if (event.payload.rtms_stream_id === this.stream) this.stop(event.payload.stop_reason === 8 ? "revoked" : "streamStopped");
      return;
    }
    if (this.stream) {
      // A retry of the same signed webhook must not create a second receiver.
      if (this.stream !== event.payload.rtms_stream_id) this.stop("transportFailed");
      return;
    }
    this.stream = event.payload.rtms_stream_id;
    this.state = "connecting";
    try {
      this.closeStream = connectZoomRtms({ ...credentials, meeting: this.input.zoomMeeting, stream: this.stream,
        url: event.payload.server_urls, sourceLanguage: zoomLanguageId(this.input.sourceLang),
        transcript: (value) => this.receive(value), state: (state) => {
          if (this.active) { this.state = state; log("info", "zoom.rtms-state", { meetingId: this.meeting.id, state }); }
        },
        ended: (reason) => this.stop(reason) });
    } catch { this.stop("transportFailed"); }
  }

  receive(value: ZoomTranscript) {
    this.checkLease();
    if (!this.active) return;
    const from = ZOOM_LANGUAGES[value.language] ?? (value.language === -1 ? this.input.sourceLang : null);
    if (!from) { this.stop("invalidLanguage"); return; }
    const key = createHash("sha256").update(JSON.stringify([value.user_id, value.start_time, value.end_time, value.timestamp, value.data])).digest("hex");
    try {
      // Persist the source and translation jobs atomically before any provider or chat call.
      const result = acceptMessage({ meeting: this.meeting, pageId: null, lang: from, body: value.data,
        speakerName: value.user_name.replace(/[\r\n]+/g, " ").trim() || null, ingestKey: `zoom:${key}` });
      if (!result.inserted) return;
      this.received++;
      publishJobCounts(this.meeting.id);
      wakeTranslationWorker();
      // Already accepted text is retained even if the live chat queue reaches its limit.
      if (this.inputs.length >= 32 || this.outputs.length >= 200) { this.stop("queueFull"); return; }
      this.inputs.push(result.message);
      log("info", "zoom.transcript", { meetingId: this.meeting.id, count: this.received });
    } catch (error) {
      this.stop(error instanceof InputError && ["queue-full", "rate-limited"].includes(error.code) ? "queueFull" : "storageFailed");
    }
  }

  private drain() {
    try {
      while (this.active && this.inputs.length) {
        const input = this.inputs[0];
        // A manual edit invalidates this version's pending chat; never send stale text.
        if (!translationJobMessage({ message_id: input.id, source_revision: input.revision })) { this.inputs.shift(); continue; }
        const stored = getMessageTranslations(input.id);
        const results = this.input.targets.map((to) => ({ to, result: to === input.lang
          ? { body: input.body, status: "ok" } : stored.find((row) => row.lang === to) }));
        if (results.some(({ result }) => result?.status === "error")) { this.stop("translationFailed"); return; }
        if (results.some(({ result }) => !result)) return;
        const chunks = results.flatMap(({ to, result }) => zoomChatChunks(input.speakerName ?? "", to, result!.body));
        if (chunks.length > 200) { this.stop("queueFull"); return; }
        if (this.outputs.length + chunks.length > 200) return;
        this.inputs.shift();
        for (const text of chunks) this.outputs.push({ sequence: ++this.sequence, text });
      }
    } catch {
      this.stop("storageFailed");
    }
  }
}

declare global { var __zoomRelay: ZoomRelay | undefined; }

export function startZoomRelay(input: ZoomStart) {
  const current = globalThis.__zoomRelay;
  current?.checkLease();
  if (current?.input.owner === input.owner && JSON.stringify(current.input) === JSON.stringify(input)) return current;
  if (current?.active) {
    throw new Error("busy");
  }
  if (!zoomSettingsStatus().configured) throw new Error("notConfigured");
  const existing = getZoomMeeting(input.zoomMeeting);
  if (existing?.status === "closed") throw new Error("invalidSession");
  if (zoomLanguageId(input.sourceLang) < 0 || !hasLanguage(input.sourceLang) || !input.targets.every(hasLanguage) ||
      new Set(input.targets).size !== input.targets.length || input.engine === input.fallbackEngine) throw new Error("invalidLanguage");
  const primary = getEngine(input.engine), fallback = input.fallbackEngine ? getEngine(input.fallbackEngine) : null;
  if ([input.sourceLang, ...input.targets].some((lang) => !primary.supports(lang) && !fallback?.supports(lang))) throw new Error("invalidLanguage");
  if (existing && (existing.engine !== input.engine || existing.fallbackEngine !== input.fallbackEngine ||
      JSON.stringify(getMeetingActiveLangs(existing.id).sort()) !== JSON.stringify([...input.targets].sort()))) throw new Error("sessionSettingsMismatch");
  const meeting = existing ?? createMeeting({ zoomMeeting: input.zoomMeeting, title: input.zoomTitle,
    engine: input.engine, fallbackEngine: input.fallbackEngine,
    translationModel: input.engine === "openai" || input.fallbackEngine === "openai" ? resolveOpenaiModel() : null,
    config: { speakerLabels: true, combinedInputFallbackLang: null,
      languages: input.targets.map((lang) => ({ lang, inputEnabled: false, outputEnabled: true })) } });
  touchEngineSetting(meeting.engine);
  // ponytail: one meeting relay per local server; separate servers for concurrent operators.
  return (globalThis.__zoomRelay = new ZoomRelay(input, meeting));
}

export function ownedZoomRelay(owner: string) {
  const relay = globalThis.__zoomRelay;
  if (!relay || relay.input.owner !== owner) throw new Error("requestFailed");
  return relay;
}
