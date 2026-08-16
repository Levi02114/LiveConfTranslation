import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings, resolveEntries } from "@/lib/i18n";
import { getLanguage, isBuiltinLanguage, type LanguageCode } from "@/lib/languages";
import {
  getMeetingLangs,
  getLastEngineSetting,
  isLanguageUsed,
  listLanguages,
  listMeetings,
  listOpenaiModels,
} from "@/lib/repo";
import { engineKeyStatus, resolveOpenaiModel } from "@/lib/secrets";
import { getEngine, listEngines, refreshEngineSupport } from "@/lib/translate";
import type { EngineId } from "@/lib/translate/types";
import { translateUiStrings } from "@/lib/ui-translate";

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

async function fillMissingUiStrings(languages: readonly LanguageCode[], preferred: EngineId) {
  const engines = [getEngine(preferred), ...listEngines()].filter(
    (engine, index, all) => all.findIndex((item) => item.id === engine.id) === index,
  );

  for (const code of languages) {
    if (!resolveEntries(code).some((entry) => entry.origin === "fallback")) continue;
    const engine = engines.find(
      (item) => item.isConfigured() && item.supports("ko") && item.supports(code),
    );
    if (engine) {
      await translateUiStrings(code, engine.id, { keepManual: true, missingOnly: true });
    }
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);
  return { title: getAdminStrings(lang).list.heading };
}

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  await refreshEngineSupport();

  const languages = listLanguages().map((row) => row.code);
  const selectedEngine = getLastEngineSetting()?.engine ?? "google";
  await fillMissingUiStrings(languages, selectedEngine);

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
      engineKeys={listEngines().map((engine) => engineKeyStatus(engine.id))}
      defaultEngine={selectedEngine}
      openaiModel={resolveOpenaiModel()}
      openaiModels={listOpenaiModels()}
    />
  );
}
