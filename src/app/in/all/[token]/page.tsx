import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import {
  getMeeting,
  getMeetingActiveLangs,
  getMeetingLanguageConfigs,
  getPageByToken,
  getRecentCombined,
  isPageEnabled,
} from "@/lib/repo";
import { engineKey } from "@/lib/secrets";
import { localTranscriptionConfigured } from "@/lib/local-runtime";

import { CombinedInputView } from "./combined-input-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ui?: string }>;
}): Promise<Metadata> {
  const page = getPageByToken((await params).token);
  if (!page || page.kind !== "combined-input" || !page.lang) return { title: "—" };
  const active = getMeetingActiveLangs(page.meetingId);
  const requested = (await searchParams).ui;
  const strings = getStrings(requested && active.includes(requested) ? requested : page.lang);
  return { title: `${strings.role.combinedInput} · ${getMeeting(page.meetingId)?.title ?? "—"}` };
}

export default async function CombinedInputPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ui?: string }>;
}) {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "combined-input" || !page.lang || !isPageEnabled(page)) notFound();
  const meeting = getMeeting(page.meetingId);
  if (!meeting) notFound();

  const activeLangs = getMeetingActiveLangs(meeting.id);
  const inputLangs = getMeetingLanguageConfigs(meeting.id)
    .filter((row) => row.inputEnabled)
    .map((row) => row.lang);
  const requested = (await searchParams).ui;
  const uiLang = requested && activeLangs.includes(requested) ? requested : page.lang;

  return (
    <CombinedInputView
      token={token}
      pageId={page.id}
      uiLang={uiLang}
      fallbackLang={page.lang}
      languages={activeLangs.map((code) => getLanguage(code, uiLang))}
      inputLanguages={inputLangs}
      strings={getStrings(uiLang)}
      meetingTitle={meeting.title}
      history={getRecentCombined(meeting.id)}
      initiallyClosed={meeting.status === "closed"}
      voiceAvailable={meeting.transcriptionProvider === "local" ? localTranscriptionConfigured() : Boolean(engineKey("openai"))}
      speakerLabels={meeting.speakerLabels}
    />
  );
}
