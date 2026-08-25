import type { LanguageCode } from "@/lib/languages";

export type SingleTranscriptionProfile = {
  model: "gpt-live-transcribe" | "gpt-transcribe";
  transport: "webrtc" | "websocket";
};

/**
 * 실측상 태국어는 gpt-transcribe 가 우세하다. 싱할라어는 실시간 언어 힌트가
 * 지원되지 않아 완료 턴을 서버에서 언어 고정 재전사해야 하므로 WebSocket 을 쓴다.
 */
export function singleTranscriptionProfile(lang: LanguageCode): SingleTranscriptionProfile {
  const primary = lang.toLowerCase().split("-")[0];
  if (primary === "th") return { model: "gpt-transcribe", transport: "websocket" };
  return {
    model: "gpt-live-transcribe",
    transport: primary === "si" ? "websocket" : "webrtc",
  };
}
