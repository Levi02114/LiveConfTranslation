import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage, isBuiltinLanguage, type LanguageCode } from "@/lib/languages";
import {
  getMeetingLangs,
  getLastEngineSetting,
  getTranscriptionProviderSetting,
  isLanguageUsed,
  listLanguages,
  listMeetings,
  listSessionPresets,
} from "@/lib/repo";
import {
  engineKeyStatus,
  googleSpeechCredentialsStatus,
  resolveOpenaiModel,
} from "@/lib/secrets";
import { listEngines, refreshEngineSupport } from "@/lib/translate";
import { localTranscriptionConfigured } from "@/lib/local-runtime";

import { MeetingList } from "./meeting-list";

export const dynamic = "force-dynamic";

/**
 * 등록된 언어를 화면에 쓸 모양으로.
 *
 * 이름은 `Intl.DisplayNames` 가 만들고(`lib/languages.ts`), `builtin`/`used` 는
 * 제거 버튼을 그릴지 정하는 데 쓴다.
 */
function describeLanguages(display: LanguageCode) {
  return listLanguages().map((row) => ({
    ...getLanguage(row.code, display),
    builtin: isBuiltinLanguage(row.code),
    used: isLanguageUsed(row.code),
  }));
}

export async function generateMetadata(): Promise<Metadata> {
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);
  const strings = getAdminStrings(lang);
  return { title: strings.list.heading, other: { "lct-site-management": strings.security.siteManagement } };
}

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  await refreshEngineSupport();

  const languages = listLanguages().map((row) => row.code);
  const selectedEngine = getLastEngineSetting()?.engine ?? "google";
  const localTranscriptionAvailable = localTranscriptionConfigured();
  const savedTranscriptionProvider = getTranscriptionProviderSetting();
  const defaultTranscriptionProvider = savedTranscriptionProvider === "local" && !localTranscriptionAvailable
    ? "openai"
    : savedTranscriptionProvider ?? (localTranscriptionAvailable ? "local" : "openai");
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, languages);

  const meetings = listMeetings().map((meeting) => ({
    ...meeting,
    langs: getMeetingLangs(meeting.id),
  }));

  return (
    <MeetingList
      key={meetings
        .map((meeting) => `${meeting.id}:${meeting.status}:${meeting.closedAt ?? ""}`)
        .join("|")}
      lang={lang}
      strings={getAdminStrings(lang)}
      ui={getStrings(lang)}
      meetings={meetings}
      languages={describeLanguages(lang)}
      defaultLangs={languages}
      engines={listEngines().map((engine) => ({
        id: engine.id,
        label: engine.label,
        configured: engine.isConfigured(),
      }))}
      engineKeys={listEngines().filter((engine) => engine.id !== "local").map((engine) => engineKeyStatus(engine.id))}
      googleSpeechCredentials={googleSpeechCredentialsStatus()}
      localTranscriptionAvailable={localTranscriptionAvailable}
      defaultTranscriptionProvider={defaultTranscriptionProvider}
      defaultEngine={selectedEngine}
      openaiModel={resolveOpenaiModel()}
      presets={listSessionPresets()}
    />
  );
}
