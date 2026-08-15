import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { defaultEngine } from "@/lib/env";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { DEFAULT_LANGUAGES, LANGUAGES } from "@/lib/languages";
import { getMeetingLangs, listMeetings } from "@/lib/repo";
import { engineKeyStatus } from "@/lib/secrets";
import { isEngineId, listEngines } from "@/lib/translate";

import { MeetingList } from "./meeting-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value);
  return { title: getAdminStrings(lang).list.heading };
}

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value);

  const meetings = listMeetings().map((meeting) => ({
    ...meeting,
    langs: getMeetingLangs(meeting.id),
  }));

  const configured = defaultEngine();

  return (
    <MeetingList
      lang={lang}
      strings={getAdminStrings(lang)}
      ui={getStrings(lang)}
      meetings={meetings}
      languages={[...LANGUAGES]}
      defaultLangs={[...DEFAULT_LANGUAGES]}
      engines={listEngines().map((engine) => ({
        id: engine.id,
        label: engine.label,
        configured: engine.isConfigured(),
      }))}
      engineKeys={listEngines().map((engine) => engineKeyStatus(engine.id))}
      defaultEngine={isEngineId(configured) ? configured : "google"}
    />
  );
}
