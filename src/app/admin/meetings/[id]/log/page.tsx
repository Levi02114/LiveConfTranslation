import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { getLogLines, getMeeting, getMeetingLangs, listLanguages } from "@/lib/repo";

import { LogView } from "./log-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const meeting = getMeeting((await params).id);
  const registered = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);
  return { title: `${getAdminStrings(lang).log.title} · ${meeting?.title ?? "—"}` };
}

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

  const registered = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);

  return (
    <LogView
      lang={lang}
      strings={getAdminStrings(lang)}
      ui={getStrings(lang)}
      displayLanguages={registered.map((code) => getLanguage(code, lang))}
      meetingId={id}
      meetingTitle={meeting.title}
      languages={getMeetingLangs(id).map((code) => getLanguage(code, lang))}
      lines={getLogLines(id)}
    />
  );
}
