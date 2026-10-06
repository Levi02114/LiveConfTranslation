import { DEFAULT_VOICE_SETTINGS } from "./voice-settings";

// ponytail: 현장 마이크 편차가 크므로 오탐이 보이면 음량 임계값만 조정한다.
const MIN_START_RMS = 0.0025;
const MIN_CONTINUE_RMS = 0.0015;
const SILENCE_MS = 1_100;
const INITIAL_NOISE_FLOOR = 0.003;

export class AudioTurnDetector {
  private noiseFloor = INITIAL_NOISE_FLOOR;
  private heardSpeech = false;
  private silentSince: number | null = null;
  private turnStartedAt: number | null = null;
  private silenceMs = SILENCE_MS;
  private maxTurnMs = DEFAULT_VOICE_SETTINGS.maxTurnMs;

  constructor(
    private readonly nextSilenceMs: () => number = () => SILENCE_MS,
    private readonly nextMaxTurnMs: () => number = () => DEFAULT_VOICE_SETTINGS.maxTurnMs,
    private readonly minRms: () => number = () => 0,
  ) {}

  phase(): "idle" | "speech" | "silence" {
    return !this.heardSpeech ? "idle" : this.silentSince === null ? "speech" : "silence";
  }

  hasSpeech(): boolean { return this.heardSpeech; }

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

    if (
      this.heardSpeech &&
      ((this.silentSince !== null && now - this.silentSince >= this.silenceMs) ||
        (this.turnStartedAt !== null && now - this.turnStartedAt >= this.maxTurnMs))
    ) {
      this.heardSpeech = false;
      this.silentSince = null;
      this.turnStartedAt = null;
      return true;
    }
    return false;
  }
}
