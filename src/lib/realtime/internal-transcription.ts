import type { LanguageCode } from "@/lib/languages";

/*
 * 브라우저 없이 서버 전사 경로(`server.ts`의 /ws/transcribe 처리)를 쓰는 연결.
 * Zoom 회의 음성처럼 서버가 직접 받은 PCM을 같은 전사·재전사·문자 검사 흐름에 넣는다.
 * 커스텀 서버가 globalThis에 구현을 등록하고 Next 번들의 Zoom 중계가 부른다.
 */
export type InternalTranscriptionEvent =
  | { t: "ready" }
  | { t: "transcript"; itemId: string; body: string; lang: LanguageCode }
  | { t: "error"; reason: string }
  | { t: "closed" };

export type InternalTranscription = {
  start: (input: { speakerName: string; lang?: LanguageCode }) => void;
  /** 24 kHz mono s16le */
  audio: (pcm: Buffer) => void;
  commit: () => void;
  heartbeat: () => void;
  close: () => void;
};

export type InternalTranscriptionRequest = {
  meetingId: string;
  /** 세션 안에서 이 음성 입력을 구분하는 키(Zoom 참가자 등). lease와 동시 전사 한도에 쓴다. */
  streamKey: string;
  languages: LanguageCode[];
  authorized: () => boolean;
  onEvent: (event: InternalTranscriptionEvent) => void;
};

declare global {
  var __liveConfInternalTranscription: ((request: InternalTranscriptionRequest) => InternalTranscription | null) | undefined;
}
