/**
 * 마이크 입력 음량 미터 로직.
 *
 * 두 음성 입력 훅(WebRTC 단일 언어·WS 태국어/통합 입력)이 같은 임계값과 표시 규칙을
 * 쓰도록 여기 모은다. 훅은 RMS·peak 를 넣고 100ms 간격으로 UI 상태만 꺼내 간다.
 */

// ponytail: 현장 마이크 편차가 크므로 안내가 너무 뜨거나 안 뜨면 이 값들만 조정한다.
const QUIET_RMS = 0.008; // 이 RMS 미만이면 "너무 작다" 후보
const QUIET_HOLD_MS = 2_500; // 이 시간 연속으로 작아야 안내를 띄운다
const CLIP_PEAK = 0.98; // 이 피크 이상이면 클리핑
const CLIP_HOLD_MS = 1_000; // 클리핑 안내를 유지하는 시간
export const METER_INTERVAL_MS = 100; // UI 갱신 주기

export type VoiceMeter = {
  /** 표시용 음량. -60dB..0dB 를 0..1 로 눌러 담는다. */
  level: number;
  clipping: boolean;
  tooQuiet: boolean;
};

/** RMS 를 표시용 0..1 로 변환한다. 말소리(-40..-12dB)가 0.33..0.8 에 놓인다. */
export function meterLevel(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export class VoiceMeterTracker {
  private quietSince: number | null = null;
  private clipUntil = 0;

  update(rms: number, peak: number, now: number): VoiceMeter {
    const level = Number.isFinite(rms) && rms > 0 ? rms : 0;
    if (level < QUIET_RMS) {
      this.quietSince ??= now;
    } else {
      this.quietSince = null;
    }
    if (peak >= CLIP_PEAK) this.clipUntil = now + CLIP_HOLD_MS;
    return {
      level: meterLevel(level),
      clipping: now < this.clipUntil,
      tooQuiet: this.quietSince !== null && now - this.quietSince >= QUIET_HOLD_MS,
    };
  }
}
