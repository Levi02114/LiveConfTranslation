"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import type { AdminStrings, UiStrings } from "@/lib/i18n";
import type { LanguageCode } from "@/lib/languages";

export function LoginForm({
  lang,
  strings,
  ui,
}: {
  lang: LanguageCode;
  strings: AdminStrings;
  ui: UiStrings;
}) {
  const router = useRouter();
  const setLang = useSetAdminLang();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!password || pending) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError(strings.login.wrongPassword);
        setPassword("");
        return;
      }

      // 서버 컴포넌트가 새 쿠키로 다시 그려지도록 갱신한 뒤 넘어간다.
      router.refresh();
      router.replace("/admin");
    } catch {
      setError(strings.login.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <AppearanceControls
        strings={ui.appearance}
        language={{ value: lang, label: strings.language.label, onChange: setLang }}
      />

      <div className="w-full max-w-[340px]">
        <div className="mb-7 font-mono text-[12px] tracking-[0.04em] text-muted">
          {strings.login.title}
        </div>

        <input
          type="password"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder={strings.login.password}
          className="app-text w-full border-0 border-b border-line bg-transparent py-2 outline-none focus:border-fg"
        />

        {error ? <div className="mt-3 font-mono text-[12px]">{error}</div> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || !password}
          className="mt-8 w-full cursor-pointer border border-fg py-3 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
        >
          {pending ? strings.login.pending : strings.login.submit}
        </button>
      </div>
    </div>
  );
}
