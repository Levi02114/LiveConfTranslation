// ponytail: 현장 마이크 편차가 크므로 오탐이 보이면 이 다섯 값만 조정한다.
const MIN_START_RMS = 0.0025;
const MIN_CONTINUE_RMS = 0.0015;
const SILENCE_MS = 1_100;
const MAX_TURN_MS = 15_000;
const INITIAL_NOISE_FLOOR = 0.003;

export class AudioTurnDetector {
  private noiseFloor = INITIAL_NOISE_FLOOR;
  private heardSpeech = false;
  private silentSince: number | null = null;
  private turnStartedAt: number | null = null;

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
      );

    if (speaking) {
      if (!this.heardSpeech) this.turnStartedAt = now;
      this.heardSpeech = true;
      this.silentSince = null;
    } else if (this.heardSpeech) {
      this.silentSince ??= now;
    }

    if (
      this.heardSpeech &&
      ((this.silentSince !== null && now - this.silentSince >= SILENCE_MS) ||
        (this.turnStartedAt !== null && now - this.turnStartedAt >= MAX_TURN_MS))
    ) {
      this.heardSpeech = false;
      this.silentSince = null;
      this.turnStartedAt = null;
      return true;
    }
    return false;
  }
}
