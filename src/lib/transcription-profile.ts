import type { LanguageCode } from "@/lib/languages";

export type SingleTranscriptionProfile = {
  model: "gpt-live-transcribe" | "gpt-transcribe";
  transport: "webrtc" | "websocket";
};

/** 실측상 태국어만 gpt-transcribe 가 우세하며, 이 모델의 커밋 방식은 WebSocket 을 쓴다. */
export function singleTranscriptionProfile(lang: LanguageCode): SingleTranscriptionProfile {
  return lang.toLowerCase().split("-")[0] === "th"
    ? { model: "gpt-transcribe", transport: "websocket" }
    : { model: "gpt-live-transcribe", transport: "webrtc" };
}
