"use client";

import { useServerVoiceInput } from "@/hooks/use-combined-voice-input";
import type { UiStrings } from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";

export type VoiceInputState = "idle" | "starting" | "active";

/** All providers use the server-owned socket; review mode still only returns a draft. */
export function useVoiceInput({
  lang,
  ...input
}: {
  token: string;
  participantId?: string;
  strings: UiStrings["capture"];
  closed: boolean;
  autoSubmit?: boolean;
  rewrite?: boolean;
  speakerName?: string | null;
  onTranscript?: (body: string) => void;
  requestPermissionOnMount?: boolean;
  lang?: LanguageCode;
  forceServerTransport?: boolean;
}) {
  return useServerVoiceInput({ ...input, langs: lang ? [lang] : [], enabled: true });
}
