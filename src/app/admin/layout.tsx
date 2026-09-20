import { cookies } from "next/headers";
import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { getSecurityLimits, getVoiceSettings, listLanguages, listMeetings } from "@/lib/repo";
import { engineKeyStatus, googleSpeechCredentialsStatus, openaiAdminKeyStatus } from "@/lib/secrets";
import { listEngines } from "@/lib/translate";
import { AppSettings } from "./app-settings";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) return children;
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);
  return <>
    <AppSettings key={lang} strings={getAdminStrings(lang)} ui={getStrings(lang)}
      languages={codes.map((code) => getLanguage(code, lang))}
      engines={listEngines().map((engine) => ({ id: engine.id, label: engine.label, configured: engine.isConfigured() }))}
      keys={listEngines().filter((engine) => engine.id !== "local").map((engine) => engineKeyStatus(engine.id))}
      google={googleSpeechCredentialsStatus()} usage={openaiAdminKeyStatus()} limits={getSecurityLimits()} voice={getVoiceSettings()}
      meetings={listMeetings().map(({ id, title }) => ({ id, title }))} />
    {children}
  </>;
}
