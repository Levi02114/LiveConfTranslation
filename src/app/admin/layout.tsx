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
  // 로그인 전후로 트리 모양을 같게 둔다. 로그인 직후 첫 router.refresh()에서 children(Zoom 실행 화면 등)이
  // 통째로 다시 마운트돼 진행 중인 상태를 잃었다.
  if (!(await isAdmin())) return <>{null}{children}</>;
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
