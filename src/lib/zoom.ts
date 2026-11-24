import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "./crypto";
import { log } from "./diagnostics";
import type { LanguageCode } from "./languages";
import { createMeeting, getMeeting, getMeetingActiveLangs, getMeetingPages, getMessageTranslations, getTranscriptionProviderSetting, getZoomMeeting,
  getZoomSettings, hasLanguage, InputError, setZoomSettings, touchEngineSetting, translationJobMessage, type Meeting, type Message } from "./repo";
import { getEngine } from "./translate";
import { resolveOpenaiModel } from "./secrets";
import { acceptMessage } from "./pipeline";
import { publishJobCounts, wakeTranslationWorker } from "./translation-worker";
import { zoomChatChunks, zoomCredentialsSchema, zoomLanguageId, ZOOM_LANGUAGES, type ZoomStart, type ZoomStatus } from "./zoom-contract";
import { cleanTranscript } from "./transcript-clean";
import { SentenceJoiner } from "./sentence-joiner";
import { ZoomSpeakerStream } from "./zoom-audio";
import { connectZoomRtms, type ZoomAudio, type ZoomTranscript, type ZoomWebhookEvent } from "./zoom-rtms";

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
  private lastMedia = Date.now();
  private state: ZoomStatus["state"] = "waiting";
  private error: string | null = null;
  private received = 0;
  private sent = 0;
  private sequence = 0;
  private lastAck = 0;
  private offered = 0;
  private stream = "";
  private serverUrls = "";
  private inputs: Message[] = [];
  private outputs: NonNullable<ZoomStatus["next"]>[] = [];
  private rtms?: { stop: () => void; reconnect: (url: string) => void };
  private readonly speakers = new Map<string, ZoomSpeakerStream>();
  private readonly assigned = new Map<string, LanguageCode>();
  private timer: ReturnType<typeof setInterval>;
  // 음성 모드 전사를 화자별로 문장 단위로 다시 묶는다. 새 전사가 20초 없으면 꼬리를 내보낸다.
  private readonly joiners = new Map<string, { joiner: SentenceJoiner; name: string; prefix: string; at: number }>();

  constructor(readonly input: ZoomStart, readonly meeting: Meeting) {
    // 채팅 전송만 하는 모드는 Zoom 스트림을 기다리지 않는다.
    if (input.audioMode === "chat") this.state = "live";
    this.timer = setInterval(() => { this.checkLease(); this.flushJoiners(20_000); }, 5000);
    this.timer.unref?.();
    log("info", "zoom.relay-start", { meetingId: meeting.id, count: input.targets.length, mode: input.audioMode });
  }

  get active() { return !["stopped", "error"].includes(this.state); }

  checkLease(now = Date.now()) {
    if (!this.active) return;
    if (getMeeting(this.meeting.id)?.status !== "open") this.stop("invalidSession");
    else if (JSON.stringify(getMeetingActiveLangs(this.meeting.id).sort()) !== JSON.stringify([...this.input.targets].sort())) this.stop("sessionSettingsMismatch");
    // 채팅 전송은 앱 창이 맡으므로 창이 사라지면 멈춘다. 채팅을 끄면 Zoom 음성이 들어오는 동안은 창 없이도 계속 받는다.
    // 채팅을 끈 경우 진짜 종료 신호는 rtms_stopped·세션 종료다. 긴 휴식에도 끊지 않게 10분을 둔다.
    else if (now - this.lastPoll > 30000 && (this.input.chat || this.input.audioMode === "chat" || now - this.lastMedia > 600000)) this.stop("leaseExpired");
    // 일반 참가자가 시작하면 호스트가 Zoom 승인 창을 누를 때까지 시작 이벤트가 오지 않는다. 그 시간을 3분 준다.
    else if (this.state === "waiting" && now - this.startedAt > 180000) this.stop("webhookTimeout");
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
    // 대기열에는 채팅에 보낼 것만 들어간다(운영자가 켠 Zoom 음성, 참가자가 직접 고른 입력).
    const next = this.active ? this.outputs[0] ?? null : null;
    if (next) this.offered = next.sequence;
    const viewer = getMeetingPages(this.meeting.id).find((page) => page.kind === "combined");
    return { session: { id: this.meeting.id, title: this.meeting.title, viewerPath: viewer ? `/all/${viewer.token}` : "" },
      state: this.state, error: this.error, received: this.received, sent: this.sent,
      pending: this.active ? this.inputs.length + this.outputs.length : 0, next,
      speakers: [...this.speakers.values()].map((stream) => ({ key: stream.key, name: stream.name,
        lang: this.assigned.get(stream.key) ?? null, active: stream.active })) };
  }

  /** 참가자별 음성 모드에서 화자의 입력 언어를 고정하거나(코드) 자동 감지로 되돌린다(null). */
  assign(speaker: string, lang: string | null) {
    if (lang !== null && !this.input.targets.includes(lang)) throw new Error("invalidLanguage");
    if (lang) this.assigned.set(speaker, lang); else this.assigned.delete(speaker);
    this.speakers.get(speaker)?.restart();
  }

  stop(reason?: string) {
    if (!this.active) return;
    this.state = reason && reason !== "streamStopped" ? "error" : "stopped";
    this.error = reason ?? null;
    clearInterval(this.timer);
    this.flushJoiners(0);
    this.rtms?.stop(); this.rtms = undefined;
    for (const stream of this.speakers.values()) stream.close();
    this.speakers.clear();
    this.inputs = []; this.outputs = [];
    log(reason ? "warn" : "info", "zoom.relay-stop", { meetingId: this.meeting.id, reason: reason ?? "requested", count: this.received });
  }

  handleWebhook(event: ZoomWebhookEvent, credentials: NonNullable<ReturnType<typeof readZoomCredentials>>) {
    if (!this.active || this.input.audioMode === "chat" || event.event === "endpoint.url_validation" || event.payload.meeting_uuid !== this.input.zoomMeeting || event.event_ts < this.startedAt - 5000) {
      log("info", "zoom.webhook-ignored", { reason: !this.active ? "inactive" : this.input.audioMode === "chat" ? "chatOnly"
        : event.event === "endpoint.url_validation" ? "validation" : "otherMeeting" });
      return;
    }
    this.checkLease();
    if (!this.active) return;
    if (event.event === "meeting.rtms_stopped") {
      if (event.payload.rtms_stream_id === this.stream) this.stop(event.payload.stop_reason === 8 ? "revoked" : "streamStopped");
      return;
    }
    if (this.stream) {
      if (this.stream !== event.payload.rtms_stream_id) { this.stop("transportFailed"); return; }
      // 같은 스트림의 시작 이벤트가 새 서버 주소로 다시 오면 Zoom의 장애 조치 신호다. 같은 주소면 재시도 중복이다.
      if (event.payload.server_urls !== this.serverUrls) {
        this.serverUrls = event.payload.server_urls;
        log("info", "zoom.rtms-failover", { meetingId: this.meeting.id });
        this.rtms?.reconnect(event.payload.server_urls);
      }
      return;
    }
    this.stream = event.payload.rtms_stream_id;
    this.serverUrls = event.payload.server_urls;
    this.state = "connecting";
    const transcriptMode = this.input.audioMode === "transcript";
    try {
      this.rtms = connectZoomRtms({ ...credentials, meeting: this.input.zoomMeeting, stream: this.stream,
        url: event.payload.server_urls,
        ...(transcriptMode
          ? { sourceLanguage: zoomLanguageId(this.input.sourceLang), transcript: (value: ZoomTranscript) => this.receive(value) }
          : { audio: { streams: this.input.audioMode === "speakers" ? "multi" as const : "mixed" as const, receive: (value: ZoomAudio) => this.receiveAudio(value) } }),
        state: (state) => {
          if (this.active) { this.state = state; log("info", "zoom.rtms-state", { meetingId: this.meeting.id, state }); }
        },
        ended: (reason) => this.stop(reason) });
    } catch { this.stop("transportFailed"); }
  }

  /** Zoom 자체 전사(transcript 모드). */
  receive(value: ZoomTranscript) {
    this.checkLease();
    if (!this.active) return;
    this.lastMedia = Date.now();
    const detected = ZOOM_LANGUAGES[value.language];
    // 감지 언어가 세션 언어가 아니면 첫 발언 언어로 받는다. 한 발언 때문에 중계 전체를 멈추지 않는다.
    const from = (detected && this.input.targets.find((code) => code.toLowerCase() === detected.toLowerCase() ||
      code.split("-")[0] === detected.split("-")[0])) ?? this.input.sourceLang;
    const key = createHash("sha256").update(JSON.stringify([value.user_id, value.start_time, value.end_time, value.timestamp, value.data])).digest("hex");
    this.accept(from, value.data, value.user_name, `zoom:${key}`);
  }

  receiveAudio(value: ZoomAudio) {
    if (!this.active || !value.pcm.length) return;
    this.lastMedia = Date.now();
    const key = this.input.audioMode === "speakers" ? String(value.userId) : "mixed";
    let stream = this.speakers.get(key);
    if (!stream) {
      if (this.speakers.size >= 64) return;
      stream = new ZoomSpeakerStream(key, this.input.audioMode === "speakers" ? value.userName : "", {
        meetingId: this.meeting.id,
        languages: () => this.input.targets,
        language: (speaker) => this.assigned.get(speaker) ?? null,
        authorized: () => this.active && getMeeting(this.meeting.id)?.status === "open",
        transcript: (source, event) => {
          if (!event.body.trim()) return;
          const entry = this.joiners.get(source.key) ?? { joiner: new SentenceJoiner(), name: source.name, prefix: `zoom:audio:${this.stream}:${source.key}`, at: 0 };
          this.joiners.set(source.key, entry);
          entry.name = source.name;
          entry.at = Date.now();
          for (const segment of entry.joiner.push(event.body, event.lang, event.itemId, entry.at)) {
            this.accept(segment.lang, segment.text, entry.name, `${entry.prefix}:${segment.key}`);
          }
        },
        unavailable: (reason) => this.stop(reason),
      });
      this.speakers.set(key, stream);
    }
    if (value.userName && this.input.audioMode === "speakers") stream.name = value.userName;
    stream.push(value.pcm);
  }

  private flushJoiners(idleMs: number) {
    for (const entry of this.joiners.values()) {
      if (Date.now() - entry.at < idleMs) continue;
      const tail = entry.joiner.flush();
      if (tail) this.accept(tail.lang, tail.text, entry.name, `${entry.prefix}:${tail.key}`);
    }
  }

  private accept(lang: string, raw: string, speaker: string, ingestKey: string) {
    const body = cleanTranscript(raw);
    if (!body) return;
    try {
      // Persist the source and translation jobs atomically before any provider or chat call.
      const result = acceptMessage({ meeting: this.meeting, pageId: null, lang, body,
        speakerName: speaker.replace(/[\r\n]+/g, " ").trim() || null, ingestKey });
      if (!result.inserted) return;
      this.received++;
      publishJobCounts(this.meeting.id);
      wakeTranslationWorker();
      log("info", "zoom.transcript", { meetingId: this.meeting.id, count: this.received });
      if (!this.input.chat) return;
      // Already accepted text is retained even if the live chat queue reaches its limit.
      if (this.inputs.length >= 32 || this.outputs.length >= 200) { this.stop("queueFull"); return; }
      this.inputs.push(result.message);
    } catch (error) {
      this.stop(error instanceof InputError && ["queue-full", "rate-limited"].includes(error.code) ? "queueFull" : "storageFailed");
    }
  }

  /**
   * 참가자가 입력 화면에서 Zoom 채팅 전송을 고른 메시지. 운영자 채팅 토글과 별개로, 번역이 끝나면
   * 같은 형식(화자 + 모든 언어 한 메시지)으로 보낸다. 대기열이 차면 받지 않지만 중계는 멈추지 않는다.
   */
  share(message: Message) {
    this.checkLease();
    if (!this.active || message.meetingId !== this.meeting.id || this.inputs.length >= 32 || this.outputs.length >= 200) return false;
    if (this.inputs.some((input) => input.id === message.id)) return true;
    this.inputs.push(message);
    log("info", "zoom.chat-share", { meetingId: this.meeting.id, count: this.inputs.length });
    return true;
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
        if (results.some(({ result }) => !result)) return;
        // 번역에 실패한 언어만 빼고 보낸다. 한 언어의 실패로 중계 전체를 멈추지 않는다.
        const rows = results.filter(({ result }) => result!.status === "ok").map(({ to, result }) => ({ lang: to, body: result!.body }));
        const chunks = zoomChatChunks(input.speakerName ?? "", rows);
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
  // Zoom 자체 전사만 Zoom 지원 언어로 시작해야 한다. 음성 모드는 우리 전사가 세션 언어를 모두 받는다.
  if ((input.audioMode === "transcript" && zoomLanguageId(input.sourceLang) < 0) || !input.targets.includes(input.sourceLang) ||
      !input.targets.every(hasLanguage) || new Set(input.targets).size !== input.targets.length || input.engine === input.fallbackEngine) throw new Error("invalidLanguage");
  const primary = getEngine(input.engine), fallback = input.fallbackEngine ? getEngine(input.fallbackEngine) : null;
  if (input.targets.some((lang) => !primary.supports(lang) && !fallback?.supports(lang))) throw new Error("invalidLanguage");
  if (existing && (existing.engine !== input.engine || existing.fallbackEngine !== input.fallbackEngine ||
      JSON.stringify(getMeetingActiveLangs(existing.id).sort()) !== JSON.stringify([...input.targets].sort()))) throw new Error("sessionSettingsMismatch");
  const meeting = existing ?? createMeeting({ zoomMeeting: input.zoomMeeting, title: input.zoomTitle,
    engine: input.engine, fallbackEngine: input.fallbackEngine,
    translationModel: input.engine === "openai" || input.fallbackEngine === "openai" ? resolveOpenaiModel() : null,
    transcriptionProvider: getTranscriptionProviderSetting() ?? "openai",
    // 사람 속기사도 같은 세션의 언어별 입력 페이지로 함께 입력할 수 있게 입력을 켠다.
    config: { speakerLabels: true, combinedInputFallbackLang: null,
      languages: input.targets.map((lang) => ({ lang, inputEnabled: true, outputEnabled: true })) } });
  touchEngineSetting(meeting.engine);
  // ponytail: one meeting relay per local server; separate servers for concurrent operators.
  return (globalThis.__zoomRelay = new ZoomRelay(input, meeting));
}

/** 입력 페이지 라우트용. 이 세션의 Zoom 중계가 돌고 있을 때만 채팅 대기열에 넣는다. */
export function shareToZoomChat(message: Message): "queued" | "unavailable" {
  return globalThis.__zoomRelay?.share(message) ? "queued" : "unavailable";
}

export function ownedZoomRelay(owner: string) {
  const relay = globalThis.__zoomRelay;
  if (!relay || relay.input.owner !== owner) throw new Error("requestFailed");
  return relay;
}
