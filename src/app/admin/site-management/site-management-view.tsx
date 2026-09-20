"use client";

import { useState, useTransition } from "react";
import { AppearanceControls } from "@/components/appearance-controls";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";
import type { SecurityLimits } from "@/lib/security-limits";
import { AdminBusyOverlay } from "../admin-busy-overlay";
import { SecuritySettings } from "../security-settings";
import { TranslationJobs } from "../translation-jobs";

export function SiteManagementView({ lang, languages, strings, ui, initial, meetings }: {
  lang: LanguageCode; languages: Language[]; strings: AdminStrings; ui: UiStrings;
  initial: SecurityLimits; meetings: { id: string; title: string }[];
}) {
  const setLang = useSetAdminLang();
  const [navigating, startNavigation] = useTransition();
  const [meetingId, setMeetingId] = useState("");
  return <main className="mx-auto max-w-[840px] px-4 pt-20 pb-12 sm:px-8">
    <AdminBusyOverlay label={navigating ? strings.login.pending : null} />
    <AppearanceControls strings={ui.appearance} language={{ value: lang, label: strings.language.label,
      options: languages, onChange: (next) => startNavigation(() => setLang(next)) }} />
    <h1 className="break-words">{strings.security.siteManagement}</h1>
    <SecuritySettings initial={initial} strings={strings.security} />
    <label className="flex min-w-0 flex-col gap-2">
      <span>{strings.security.jobSession}</span>
      <select value={meetingId} onChange={(event) => setMeetingId(event.target.value)}
        className="min-w-0 max-w-full border border-line bg-bg px-3 py-2 text-fg">
        <option value="">{strings.security.chooseSession}</option>
        {meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}
      </select>
    </label>
    {meetingId ? <TranslationJobs key={meetingId} meetingId={meetingId} strings={strings.security} /> : null}
  </main>;
}
