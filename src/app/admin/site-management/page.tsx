import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { isAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { listLanguages } from "@/lib/repo";
import { LoginForm } from "../login/login-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);
  const title = getAdminStrings(lang).security.siteManagement;
  return { title, other: { "lct-site-management": title } };
}

export default async function SiteManagementPage() {
  const codes = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, codes);
  const strings = getAdminStrings(lang);
  const ui = getStrings(lang);
  const languages = codes.map((code) => getLanguage(code, lang));
  if (!(await isAdmin())) {
    return <LoginForm lang={lang} languages={languages} strings={strings} ui={ui} destination="/admin/site-management" />;
  }
  redirect("/admin?settings=security");
}
