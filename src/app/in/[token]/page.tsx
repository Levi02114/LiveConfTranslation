import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import {
  getMeeting,
  getMeetingActiveLangs,
  getPageByToken,
  getRecentCombined,
  isPageEnabled,
} from "@/lib/repo";
import { transcriptionProviderConfigured } from "@/lib/secrets";

import { InputView } from "./input-view";

export const dynamic = "force-dynamic";

/** 탭 제목도 그 페이지 언어로 나와야 한다. 참석자 화면에 한국어가 섞이면 안 된다. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "input" || !page.lang) return { title: "—" };

  const strings = getStrings(page.lang);
  return { title: `${getLanguage(page.lang).nativeName} · ${strings.role.input}` };
}

/**
 * 속기사 입력 페이지. 언어 하나에 페이지 하나.
 *
 * 로그인이 없다. URL 토큰을 아는 것이 곧 권한이다(`lib/ids.ts` 참고).
 * 초기 데이터를 API 로 한 번 더 왕복하지 않고 여기서 바로 읽어 넘긴다.
 */
export default async function InputPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const page = getPageByToken(token);
  if (!page || page.kind !== "input" || !page.lang || !isPageEnabled(page)) notFound();
  const pageLang = page.lang;

  const meeting = getMeeting(page.meetingId);
  if (!meeting) notFound();

  return (
    <InputView
      token={token}
      pageId={page.id}
      language={getLanguage(pageLang)}
      languages={getMeetingActiveLangs(meeting.id).map((code) => getLanguage(code, pageLang))}
      strings={getStrings(pageLang)}
      meetingTitle={meeting.title}
      history={getRecentCombined(meeting.id)}
      initiallyClosed={meeting.status === "closed"}
      voiceAvailable={transcriptionProviderConfigured(meeting.transcriptionProvider)}
      rewriteAvailable={transcriptionProviderConfigured("openai")}
      serverTranscription={meeting.transcriptionProvider !== "openai"}
      speakerLabels={meeting.speakerLabels}
    />
  );
}
