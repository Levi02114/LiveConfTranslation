"use client";

import Link from "next/link";
import { useTransition } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";

import { AdminBusyOverlay } from "./admin/admin-busy-overlay";

export function HomeView({
  lang,
  strings,
  ui,
  languages,
}: {
  lang: LanguageCode;
  strings: AdminStrings;
  ui: UiStrings;
  languages: Language[];
}) {
  const setLang = useSetAdminLang();
  const [navigating, startNavigation] = useTransition();

  return (
    <main lang={lang} className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <AdminBusyOverlay label={navigating ? strings.list.loading : null} />
      <AppearanceControls
        strings={ui.appearance}
        language={{
          value: lang,
          label: strings.language.label,
          options: languages,
          onChange: (next) => startNavigation(() => setLang(next)),
        }}
      />

      <div>
        <h1 className="text-xl font-semibold">{strings.home.title}</h1>
        <p className="mt-2 text-sm text-muted">{strings.home.description}</p>
      </div>

      <Link
        href="/admin"
        className="inline-flex w-fit items-center border border-fg px-4 py-2 text-sm font-medium transition-colors hover:bg-fg hover:text-bg"
      >
        {strings.home.login}
      </Link>

      <p className="text-xs text-muted">{strings.home.direct}</p>
    </main>
  );
}
