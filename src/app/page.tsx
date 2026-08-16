import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { listLanguages } from "@/lib/repo";

import { HomeView } from "./home-view";

export const dynamic = "force-dynamic";

async function locale() {
  const registered = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);
  return { lang, registered };
}

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await locale();
  const strings = getAdminStrings(lang).home;
  return { title: strings.title, description: strings.description };
}

export default async function HomePage() {
  const { lang, registered } = await locale();
  return (
    <HomeView
      lang={lang}
      strings={getAdminStrings(lang)}
      ui={getStrings(lang)}
      languages={registered.map((code) => getLanguage(code, lang))}
    />
  );
}
