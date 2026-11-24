"use client";

import { useEffect, useState } from "react";

import type { UiStrings } from "@/lib/i18n-builtin";

export type ZoomChatMode = "off" | "voice" | "all";

const MODES: readonly ZoomChatMode[] = ["off", "voice", "all"];

/**
 * 참가자 각자가 고르는 Zoom 채팅 전송 범위. 운영자가 일괄로 정하지 않는다.
 * 세션 토큰별로 이 브라우저에 저장해 새로고침·새 창에서도 유지한다.
 */
export function useZoomChatMode(token: string, enabled: boolean) {
  const [mode, setMode] = useState<ZoomChatMode>("off");
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      try {
        const saved = MODES.find((value) => value === localStorage.getItem(`lct.zoomChat.${token}`));
        if (saved) setMode(saved);
      } catch {
        // 저장소를 막은 브라우저에서는 현재 탭에서만 유지한다.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, token]);
  const select = (next: ZoomChatMode) => {
    setMode(next);
    try {
      localStorage.setItem(`lct.zoomChat.${token}`, next);
    } catch {
      // 위와 같다.
    }
  };
  return [enabled ? mode : "off", select] as const;
}

/** 이 입력을 Zoom 채팅에도 보낼지. 마이크 입력은 자동 전송과 검토 후 보낸 음성 초안을 모두 포함한다. */
export function zoomChatFor(mode: ZoomChatMode, voice: boolean) {
  return mode === "all" || (mode === "voice" && voice);
}

export function ZoomChatSelect({
  strings,
  value,
  onChange,
}: {
  strings: UiStrings["zoomChat"];
  value: ZoomChatMode;
  onChange: (next: ZoomChatMode) => void;
}) {
  return (
    <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <span className="whitespace-nowrap">{strings.label}</span>
      <select
        value={value}
        onChange={(event) => onChange(MODES.find((mode) => mode === event.target.value) ?? "off")}
        className="h-9 max-w-full border border-line bg-bg px-2 text-fg outline-none"
      >
        <option value="off">{strings.off}</option>
        <option value="voice">{strings.voice}</option>
        <option value="all">{strings.all}</option>
      </select>
    </label>
  );
}
