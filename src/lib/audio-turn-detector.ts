import { DEFAULT_VOICE_SETTINGS } from "./voice-settings";

// ponytail: 현장 마이크 편차가 크므로 오탐이 보이면 음량 임계값만 조정한다.
const MIN_START_RMS = 0.0025;
const MIN_CONTINUE_RMS = 0.0015;
const SILENCE_MS = 1_100;
const INITIAL_NOISE_FLOOR = 0.003;

// 최대 시간의 절반을 넘긴 턴은 이만큼의 짧은 숨 틈에서 먼저 끊는다. 쉬지 않고 이어 말하는 연설이
// 최대 시간 강제 컷으로 단어·문장 한가운데서 잘리는 일을 줄인다.
export const SOFT_PAUSE_MS = 350;
export function softCutAfterMs(maxTurnMs: number): number { return Math.max(4_000, maxTurnMs / 2); }

export class AudioTurnDetector {
  private noiseFloor = INITIAL_NOISE_FLOOR;
  private heardSpeech = false;
  private silentSince: number | null = null;
  private turnStartedAt: number | null = null;
  private silenceMs = SILENCE_MS;
  private maxTurnMs = DEFAULT_VOICE_SETTINGS.maxTurnMs;
  /** 마지막 확정이 최대 발화 시간 강제 컷이었는지. */
  lastCutForced = false;

  constructor(
    private readonly nextSilenceMs: () => number = () => SILENCE_MS,
    private readonly nextMaxTurnMs: () => number = () => DEFAULT_VOICE_SETTINGS.maxTurnMs,
    private readonly minRms: () => number = () => 0,
  ) {}

  phase(): "idle" | "speech" | "silence" {
    return !this.heardSpeech ? "idle" : this.silentSince === null ? "speech" : "silence";
  }

  hasSpeech(): boolean { return this.heardSpeech; }

  /** 프레임이 끊겨 바깥에서 턴을 끝냈을 때 다음 발화를 새 턴으로 시작한다. */
  reset(): void {
    this.heardSpeech = false;
    this.silentSince = null;
    this.turnStartedAt = null;
  }

  calibrate(rms: number): void {
    const level = Number.isFinite(rms) && rms > 0 ? rms : 0;
    this.noiseFloor += (level - this.noiseFloor) * 0.08;
  }

  update(rms: number, now: number): boolean {
    const level = Number.isFinite(rms) && rms > 0 ? rms : 0;
    if (!this.heardSpeech) {
      this.noiseFloor +=
        (level - this.noiseFloor) * (level < this.noiseFloor ? 0.08 : 0.01);
    }

    const speaking =
      level >=
      Math.max(
        this.heardSpeech ? MIN_CONTINUE_RMS : MIN_START_RMS,
        this.noiseFloor * 1.6,
        this.minRms(),
      );

    if (speaking) {
      if (!this.heardSpeech) {
        this.turnStartedAt = now;
        this.silenceMs = this.nextSilenceMs();
        this.maxTurnMs = this.nextMaxTurnMs();
      }
      this.heardSpeech = true;
      this.silentSince = null;
    } else if (this.heardSpeech) {
      this.silentSince ??= now;
    }

    const turnMs = this.turnStartedAt === null ? 0 : now - this.turnStartedAt;
    if (
      this.heardSpeech &&
      ((this.silentSince !== null && (now - this.silentSince >= this.silenceMs ||
        (turnMs >= softCutAfterMs(this.maxTurnMs) && now - this.silentSince >= SOFT_PAUSE_MS))) ||
        turnMs >= this.maxTurnMs)
    ) {
      this.lastCutForced = this.silentSince === null && turnMs >= this.maxTurnMs;
      this.heardSpeech = false;
      this.silentSince = null;
      this.turnStartedAt = null;
      return true;
    }
    return false;
  }
}
