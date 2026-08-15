import { notFound, redirect } from "next/navigation";

import { isAdmin } from "@/lib/auth";
import { getLanguage } from "@/lib/languages";
import { getLogLines, getMeeting, getMeetingLangs } from "@/lib/repo";

import { LogView } from "./log-view";

export const dynamic = "force-dynamic";

/**
 * 회의 로그. 대시보드에서 **팝업 창으로** 열린다.
 *
 * 그래서 네비게이션이 없다 — 이 창은 로그만 보고 닫는 용도다.
 */
export default async function LogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) notFound();

  return (
    <LogView
      meetingId={id}
      meetingTitle={meeting.title}
      languages={getMeetingLangs(id).map(getLanguage)}
      lines={getLogLines(id)}
    />
  );
}
