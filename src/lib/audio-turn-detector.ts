// ponytail: 현장 마이크 편차를 흡수하되, 오탐이 보이면 이 다섯 값만 조정한다.
const MIN_START_RMS = 0.003;
const MIN_CONTINUE_RMS = 0.002;
const SILENCE_MS = 800;
const MAX_TURN_MS = 20_000;
const INITIAL_NOISE_FLOOR = 0.003;

export class AudioTurnDetector {
  private noiseFloor = INITIAL_NOISE_FLOOR;
  private heardSpeech = false;
  private silentSince: number | null = null;
  private turnStartedAt: number | null = null;

  update(rms: number, now: number): boolean {
    const level = Number.isFinite(rms) && rms > 0 ? rms : 0;
    if (!this.heardSpeech) {
      this.noiseFloor +=
        (level - this.noiseFloor) * (level < this.noiseFloor ? 0.08 : 0.001);
    }

    const speaking =
      level >=
      Math.max(
        this.heardSpeech ? MIN_CONTINUE_RMS : MIN_START_RMS,
        this.noiseFloor * (this.heardSpeech ? 1.8 : 3),
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
