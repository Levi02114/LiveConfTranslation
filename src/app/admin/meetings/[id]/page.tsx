import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import {
  getMeeting,
  getMeetingActiveLangs,
  getMeetingActivity,
  getMeetingLanguageConfigs,
  getMeetingLangs,
  getMeetingPages,
  getRecentCombined,
  listSessionPresets,
  listLanguages,
} from "@/lib/repo";
import { engineCoverage, refreshEngineSupport } from "@/lib/translate";

import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const meeting = getMeeting((await params).id);
  const registered = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);
  return { title: `${meeting?.title ?? "—"} · ${getAdminStrings(lang).list.heading}` };
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  await refreshEngineSupport();

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) notFound();

  const langs = getMeetingLangs(id);
  const activeLangs = getMeetingActiveLangs(id);
  const registered = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);

  return (
    <DashboardView
      key={lang}
      lang={lang}
      strings={getAdminStrings(lang)}
      ui={getStrings(lang)}
      displayLanguages={registered.map((code) => getLanguage(code, lang))}
      meeting={meeting}
      languages={langs.map((code) => getLanguage(code, lang))}
      pages={getMeetingPages(id)}
      languageConfigs={getMeetingLanguageConfigs(id)}
      presets={listSessionPresets()}
      configLocked={getMeetingActivity(id).messageCount > 0 || meeting.status === "closed"}
      history={getRecentCombined(id, 40)}
      coverage={engineCoverage(meeting.engine, activeLangs)}
      fallbackCoverage={
        meeting.fallbackEngine ? engineCoverage(meeting.fallbackEngine, activeLangs) : null
      }
    />
  );
}
