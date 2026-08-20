"use client";

import type { UiStrings } from "@/lib/i18n-builtin";
import type { VoiceMeter } from "@/lib/voice-level";

/**
 * 마이크 입력 음량 막대와 너무 작음·클리핑 안내.
 * 음성 수집이 켜져 있을 때만 보인다(훅이 meter 를 null 로 돌려주면 숨긴다).
 */
export function VoiceLevelMeter({
  meter,
  strings,
}: {
  meter: VoiceMeter | null;
  strings: UiStrings["capture"];
}) {
  if (!meter) return null;
  const hint = meter.clipping
    ? strings.levelClipping
    : meter.tooQuiet
      ? strings.levelTooQuiet
      : null;
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
        <span className="min-w-0 font-mono text-[11px] leading-4 text-fg">{hint}</span>
      ) : null}
    </div>
  );
}
