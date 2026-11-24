import { AudioTurnDetector } from "./audio-turn-detector";
import { log } from "./diagnostics";
import type { LanguageCode } from "./languages";
import type { InternalTranscription, InternalTranscriptionEvent } from "./realtime/internal-transcription";
import { getVoiceSettings } from "./repo";
import { noiseGateRms } from "./voice-level";
import { silenceMsFor } from "./voice-settings";

/** Zoom RTMS L16 16 kHz → 전사 경로의 24 kHz. 청크마다 3/2 선형 보간한다(음성 인식에는 충분하다). */
export function upsample16kTo24k(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const outputLength = Math.floor(samples * 3 / 2);
  const output = Buffer.alloc(outputLength * 2);
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * 2 / 3;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples - 1);
    const fraction = position - left;
    const value = pcm.readInt16LE(left * 2) * (1 - fraction) + pcm.readInt16LE(right * 2) * fraction;
    output.writeInt16LE(Math.round(value), index * 2);
  }
  return output;
}

/** 브라우저 워클릿과 같은 척도(int16/32768의 RMS)라 무음 판정 임계값을 그대로 쓴다. */
export function pcmRms(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = pcm.readInt16LE(index * 2) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

const BYTES_PER_MS = 48; // 24 kHz × 2 bytes
const PREROLL_BYTES = 500 * BYTES_PER_MS;
// 서버 전사 경로의 초기 수신 허용량(256 KB)보다 작게 둔다.
const MAX_QUEUED_BYTES = 4_000 * BYTES_PER_MS;
const IDLE_CLOSE_MS = 120_000;
const BUSY_RETRY_MS = 10_000;

export type ZoomSpeakerHost = {
  meetingId: string;
  languages: () => LanguageCode[];
  /** 지정 언어. null이면 세션 언어 중 자동 감지. */
  language: (key: string) => LanguageCode | null;
  authorized: () => boolean;
  transcript: (stream: ZoomSpeakerStream, event: Extract<InternalTranscriptionEvent, { t: "transcript" }>) => void;
  unavailable: (reason: string) => void;
};

/**
 * Zoom 참가자 한 명(또는 합친 음성 하나)의 음성 입력.
 *
 * 말하는 동안만 전사 서버로 보낸다(침묵 비용을 내지 않는다). 발화 시작이 잘리지 않게
 * 직전 0.5초를 함께 보내고, 전사 연결은 첫 발화 때 열어 2분 동안 조용하면 닫는다.
 */
export class ZoomSpeakerStream {
  name: string;
  lastSpeech = 0;
  private session: InternalTranscription | null = null;
  private ready = false;
  private queued: Buffer[] = [];
  private queuedBytes = 0;
  private preroll: Buffer[] = [];
  private prerollBytes = 0;
  private speaking = false;
  private pendingCommit = false;
  private pending = 0;
  private retryAt = 0;
  private sessionLang: LanguageCode | null = null;
  private lastFrame = 0;
  private ticks = 0;
  // 프레임(100 ms)마다 DB를 읽지 않도록 음성 설정은 타이머에서 갱신한다.
  private voice = getVoiceSettings();
  private readonly detector: AudioTurnDetector;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(readonly key: string, name: string, private readonly host: ZoomSpeakerHost) {
    this.name = name;
    this.detector = new AudioTurnDetector(() => this.silenceMs(), () => this.voice.maxTurnMs, () => noiseGateRms(this.voice.noiseGateLevel));
    this.heartbeat = setInterval(() => this.tick(), 1_000);
    this.heartbeat.unref?.();
  }

  private silenceMs() {
    const lang = this.host.language(this.key);
    return silenceMsFor(this.voice, lang ? [lang] : this.host.languages(), !lang);
  }

  get active() { return this.speaking || this.pending > 0; }

  push(raw: Buffer, now = Date.now()) {
    this.lastFrame = now;
    const pcm = upsample16kTo24k(raw);
    const commit = this.detector.update(pcmRms(pcm), now);
    if (!this.speaking && (this.detector.hasSpeech() || commit)) {
      if (now < this.retryAt) return;
      this.speaking = true;
      this.lastSpeech = now;
      this.ensureSession();
      for (const chunk of this.preroll) this.forward(chunk);
      this.preroll = []; this.prerollBytes = 0;
    }
    if (!this.speaking) {
      this.preroll.push(pcm); this.prerollBytes += pcm.length;
      while (this.prerollBytes > PREROLL_BYTES && this.preroll.length > 1) this.prerollBytes -= this.preroll.shift()!.length;
      return;
    }
    this.lastSpeech = now;
    this.forward(pcm);
    if (commit) this.endTurn();
  }

  private endTurn() {
    this.speaking = false;
    this.pending += 1;
    if (this.ready) this.session?.commit();
    else this.pendingCommit = true;
  }

  /** 지정 언어가 바뀌면 다음 발화부터 새 연결로 받는다. */
  restart() {
    if (!this.pending) this.closeSession();
  }

  close() {
    clearInterval(this.heartbeat);
    this.closeSession();
  }

  private forward(pcm: Buffer) {
    if (this.ready) { this.session?.audio(pcm); return; }
    this.queued.push(pcm); this.queuedBytes += pcm.length;
    while (this.queuedBytes > MAX_QUEUED_BYTES && this.queued.length > 1) this.queuedBytes -= this.queued.shift()!.length;
  }

  private ensureSession() {
    if (this.session) return;
    const bridge = globalThis.__liveConfInternalTranscription;
    const lang = this.host.language(this.key);
    let session: InternalTranscription | null = null;
    session = bridge?.({ meetingId: this.host.meetingId, streamKey: `zoom:${this.key}`, languages: this.host.languages(),
      authorized: this.host.authorized, onEvent: (event) => this.onEvent(session, event) }) ?? null;
    if (!session) { this.host.unavailable("transcriptionUnavailable"); return; }
    this.session = session;
    this.sessionLang = lang;
    this.ready = false;
    const start: Parameters<InternalTranscription["start"]>[0] = { speakerName: this.name || "Zoom" };
    if (lang) start.lang = lang;
    session.start(start);
  }

  private onEvent(session: InternalTranscription | null, event: InternalTranscriptionEvent) {
    if (!session || session !== this.session) return;
    if (event.t === "ready") {
      this.ready = true;
      for (const chunk of this.queued) session.audio(chunk);
      this.queued = []; this.queuedBytes = 0;
      if (this.pendingCommit) { this.pendingCommit = false; session.commit(); }
    } else if (event.t === "transcript") {
      this.pending = Math.max(0, this.pending - 1);
      this.host.transcript(this, event);
    } else if (event.t === "error") {
      log("warn", "zoom.audio-transcription", { reason: event.reason });
      if (["key-required", "google-unavailable", "local-unavailable"].includes(event.reason)) this.host.unavailable("transcriptionUnavailable");
      else if (event.reason === "busy") this.retryAt = Date.now() + BUSY_RETRY_MS;
    } else if (event.t === "closed") {
      this.session = null; this.ready = false; this.pending = 0; this.pendingCommit = false;
      this.queued = []; this.queuedBytes = 0;
      this.speaking = false;
    }
  }

  /** 1초마다. 참가자별 스트림은 조용한 참가자의 패킷이 아예 오지 않을 수 있어, 프레임이 끊기면 여기서 턴을 끝낸다. */
  tick(now = Date.now()) {
    if (++this.ticks % 5 === 0) this.voice = getVoiceSettings();
    if (this.speaking && now - this.lastFrame >= this.silenceMs()) { this.detector.reset(); this.endTurn(); }
    if (!this.session) return;
    if (this.sessionLang !== this.host.language(this.key) && !this.speaking && !this.pending) { this.closeSession(); return; }
    if (!this.speaking && !this.pending && now - this.lastSpeech > IDLE_CLOSE_MS) { this.closeSession(); return; }
    if (this.ready && this.ticks % 5 === 0) this.session.heartbeat();
  }

  private closeSession() {
    const session = this.session;
    this.session = null; this.ready = false; this.pending = 0; this.pendingCommit = false;
    this.queued = []; this.queuedBytes = 0;
    session?.close();
  }
}
