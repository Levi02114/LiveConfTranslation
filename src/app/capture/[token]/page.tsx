import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { getMeeting, getPageByToken, getRecentMessages, isPageEnabled } from "@/lib/repo";
import { transcriptionProviderConfigured } from "@/lib/secrets";

import { CaptureView } from "./capture-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "capture" || !page.lang) return { title: "—" };

  const strings = getStrings(page.lang);
  return { title: `${getLanguage(page.lang).nativeName} · ${strings.role.capture}` };
}

export default async function CapturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "capture" || !page.lang || !isPageEnabled(page)) notFound();

  const meeting = getMeeting(page.meetingId);
  if (!meeting || meeting.inputMode !== "realtime") notFound();

  return (
    <CaptureView
      token={token}
      language={getLanguage(page.lang)}
      strings={getStrings(page.lang)}
      meetingTitle={meeting.title}
      history={getRecentMessages(meeting.id).filter((message) => message.lang === page.lang)}
      initiallyClosed={meeting.status === "closed"}
      voiceAvailable={transcriptionProviderConfigured(meeting.transcriptionProvider)}
      serverTranscription={meeting.transcriptionProvider !== "openai"}
    />
  );
}
