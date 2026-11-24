"use client";

import type { UiStrings } from "@/lib/i18n-builtin";
import type { VoiceMeter } from "@/lib/voice-level";

/**
 * 음량 안내 문구. 컴퓨터 소리는 마이크를 가까이 할 수 없으므로 "너무 작음"을 띄우지 않는다. 소리가 안 들어오면
 * 재생 중인 소리가 없다고 알리고, macOS는 권한을 거부해도 오류 없이 무음이 올 수 있어 권한 위치도 함께 알린다.
 */
export function voiceLevelHint(meter: VoiceMeter, strings: UiStrings["capture"], systemAudio = false): string | null {
  if (meter.noSignal) {
    if (!systemAudio) return strings.noSignal;
    return /Mac/.test(navigator.userAgent) ? strings.systemAudioSilentMac : strings.systemAudioSilent;
  }
  if (meter.clipping) return strings.levelClipping;
  return meter.tooQuiet && !systemAudio ? strings.levelTooQuiet : null;
}

/**
 * 마이크 입력 음량 막대와 너무 작음·클리핑 안내.
 * 음성 수집이 켜져 있을 때만 보인다(훅이 meter 를 null 로 돌려주면 숨긴다).
 */
export function VoiceLevelMeter({
  meter,
  strings,
  systemAudio = false,
}: {
  meter: VoiceMeter | null;
  strings: UiStrings["capture"];
  systemAudio?: boolean;
}) {
  if (!meter) return null;
  const hint = voiceLevelHint(meter, strings, systemAudio);
  return (
    <div className="flex min-w-[160px] flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
      <div
        role="meter"
        aria-label={strings.level}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(meter.level * 100)}
        className="h-[7px] min-w-[72px] max-w-[220px] flex-1 border border-line"
      >
        <div
          className={`h-full ${meter.clipping ? "bg-fg" : "bg-muted"}`}
          style={{ width: `${Math.round(meter.level * 100)}%` }}
        />
      </div>
      {hint ? (
        <span
          role="status"
          className={`ml-auto w-full min-w-0 text-right font-mono text-[11px] leading-4 sm:w-auto ${meter.noSignal ? "text-warning" : "text-fg"}`}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}
