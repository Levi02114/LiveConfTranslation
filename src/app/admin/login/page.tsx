import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { listLanguages } from "@/lib/repo";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);
  return { title: getAdminStrings(lang).login.title };
}

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");

  // 표시 언어는 쿠키에 있다. 서버가 처음부터 맞는 언어로 그려야 깜빡이지 않는다.
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);

  return (
    <LoginForm
      lang={lang}
      languages={codes.map((code) => getLanguage(code, lang))}
      strings={getAdminStrings(lang)}
      ui={getStrings(lang)}
    />
  );
}
