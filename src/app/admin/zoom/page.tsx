import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { getLastEngineSetting, listLanguages } from "@/lib/repo";
import { listEngines } from "@/lib/translate";
import { resolveOpenaiModel } from "@/lib/secrets";
import { LoginForm } from "../login/login-form";
import { ZoomPanel, ZoomSettings } from "../zoom-controls";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, listLanguages().map((row) => row.code));
  return { title: getAdminStrings(lang).zoom.title };
}

export default async function ZoomPage() {
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);
  const strings = getAdminStrings(lang);
  const languages = codes.map((code) => getLanguage(code, lang));
  if (!(await isAdmin())) return <LoginForm lang={lang} languages={languages} strings={strings} ui={getStrings(lang)} destination="/admin/zoom" />;
  const engines = listEngines().map((engine) => ({ id: engine.id, label: engine.label, configured: engine.isConfigured() }));
  return <main className="mx-auto grid w-full max-w-3xl min-w-0 gap-8 p-4 text-fg sm:p-6" style={{ paddingTop: "calc(var(--admin-controls-height, 4rem) + 1rem)" }}>
    <ZoomPanel strings={strings} ui={getStrings(lang)} lang={lang} languages={languages} engines={engines}
      defaultEngine={getLastEngineSetting()?.engine ?? "google"} openaiModel={resolveOpenaiModel()} />
    <details className="min-w-0 border-t border-line pt-4"><summary className="cursor-pointer">{strings.zoom.setup}</summary><div className="pt-4"><ZoomSettings strings={strings} /></div></details>
  </main>;
}
