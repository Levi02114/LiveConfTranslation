import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import {
  getMeeting,
  getMeetingLangs,
  getPageByToken,
  getRecentCombined,
} from "@/lib/repo";

import { CombinedView } from "./combined-view";

export const dynamic = "force-dynamic";

/** 통합 보기는 특정 언어에 속하지 않으므로 회의 제목을 그대로 쓴다. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const page = getPageByToken(token);
  const meeting = page ? getMeeting(page.meetingId) : null;
  return { title: meeting ? `${meeting.title} · ${getStrings("ko").role.combined}` : "—" };
}

/**
 * 통합 보기. 원문 한 줄 아래에 모든 언어의 번역이 나란히 붙는다.
 *
 * 특정 언어에 속하지 않는 화면이라 UI 문구는 한국어로 고정한다
 * (운영자·진행자가 보는 화면이라는 전제).
 */
export default async function CombinedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const page = getPageByToken(token);
  if (!page || page.kind !== "combined") notFound();

  const meeting = getMeeting(page.meetingId);
  if (!meeting) notFound();

  return (
    <CombinedView
      token={token}
      strings={getStrings("ko")}
      languages={getMeetingLangs(meeting.id).map(getLanguage)}
      meetingTitle={meeting.title}
      history={getRecentCombined(meeting.id)}
      initiallyClosed={meeting.status === "closed"}
    />
  );
}
