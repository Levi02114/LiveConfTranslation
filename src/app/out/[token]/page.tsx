import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { getMeeting, getPageByToken, getRecentTranslations } from "@/lib/repo";

import { OutputView } from "./output-view";

export const dynamic = "force-dynamic";

/** 탭 제목도 그 페이지 언어로 나와야 한다. 참석자 화면에 한국어가 섞이면 안 된다. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "output" || !page.lang) return { title: "—" };

  const strings = getStrings(page.lang);
  return { title: `${getLanguage(page.lang).nativeName} · ${strings.role.output}` };
}

/**
 * 참석자 출력 페이지. 자기 언어로 번역된 문장만 흘러간다.
 *
 * 중간에 들어온 사람도 앞의 흐름을 볼 수 있도록 지난 번역을 함께 내려 준다.
 */
export default async function OutputPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const page = getPageByToken(token);
  if (!page || page.kind !== "output" || !page.lang) notFound();

  const meeting = getMeeting(page.meetingId);
  if (!meeting) notFound();

  const history = getRecentTranslations(meeting.id, page.lang).map((row) => ({
    id: row.messageId,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt,
  }));

  return (
    <OutputView
      token={token}
      language={getLanguage(page.lang)}
      strings={getStrings(page.lang)}
      meetingTitle={meeting.title}
      history={history}
      initiallyClosed={meeting.status === "closed"}
    />
  );
}
