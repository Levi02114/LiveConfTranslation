"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import type { AdminStrings, UiStrings } from "@/lib/i18n";
import type { Language, LanguageCode } from "@/lib/languages";
import { formatTimestamp } from "@/lib/log-format";
import type { Meeting } from "@/lib/repo";
import type { EngineId } from "@/lib/translate/types";

import { EngineKeysDialog, type EngineKeyStatus } from "./engine-keys-dialog";

type Row = Meeting & { langs: LanguageCode[] };

export function MeetingList({
  lang,
  strings,
  ui,
  meetings,
  languages,
  defaultLangs,
  engines: initialEngines,
  engineKeys,
  defaultEngine,
}: {
  lang: LanguageCode;
  strings: AdminStrings;
  ui: UiStrings;
  meetings: Row[];
  languages: Language[];
  defaultLangs: LanguageCode[];
  engines: { id: EngineId; label: string; configured: boolean }[];
  engineKeys: EngineKeyStatus[];
  defaultEngine: EngineId;
}) {
  const router = useRouter();
  const setLang = useSetAdminLang();

  const [title, setTitle] = useState("");
  const [langs, setLangs] = useState<LanguageCode[]>(defaultLangs);
  const [engine, setEngine] = useState<EngineId>(defaultEngine);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 키를 등록하면 "(키 없음)" 표시가 즉시 사라져야 한다.
  const [engines, setEngines] = useState(initialEngines);

  const toggle = (code: LanguageCode) => {
    setLangs((prev) =>
      prev.includes(code) ? prev.filter((value) => value !== code) : [...prev, code],
    );
  };

  const create = async () => {
    if (pending) return;
    if (!title.trim()) {
      setError(strings.list.needTitle);
      return;
    }
    if (langs.length < 2) {
      setError(strings.list.needLanguages);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), langs, engine }),
      });
      const payload = (await response.json()) as { meeting?: Meeting; error?: string };

      if (!response.ok || !payload.meeting) {
        setError(payload.error ?? strings.list.createFailed);
        return;
      }
      router.push(`/admin/meetings/${payload.meeting.id}`);
    } catch {
      setError(strings.list.createFailed);
    } finally {
      setPending(false);
    }
  };

  const logout = async () => {
    // 라우트 핸들러가 JSON 을 돌려주므로 폼 전송이 아니라 fetch 로 부른다.
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
    router.replace("/admin/login");
  };

  const open = meetings.filter((meeting) => meeting.status === "open");
  const closed = meetings.filter((meeting) => meeting.status === "closed");

  /*
   * 언어 이름은 그 언어 표기(`nativeName`)로 쓴다. 관리자 화면이 네 언어로 뜨는데
   * 언어 목록만 한국어면 읽을 수 없고, 언어 이름 16벌을 따로 번역할 이유도 없다.
   */
  const nameList = (codes: LanguageCode[]) =>
    codes
      .map((code) => languages.find((language) => language.code === code)?.nativeName ?? code)
      .join(" · ");

  return (
    <div className="mx-auto max-w-[840px] px-8 pt-20 pb-16">
      <AppearanceControls
        strings={ui.appearance}
        language={{ value: lang, label: strings.language.label, onChange: setLang }}
      />

      <div className="flex items-baseline justify-between gap-4">
        <div className="font-mono text-[12px] tracking-[0.04em] text-muted">
          {strings.list.heading}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
        >
          {strings.list.logout}
        </button>
      </div>

      <div className="flex flex-col gap-6 border-b border-line pt-6 pb-9">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={strings.list.titlePlaceholder}
          className="app-text border-0 border-b border-line bg-transparent py-1.5 outline-none focus:border-fg"
        />

        <div>
          <div className="mb-2.5 font-mono text-[11px] text-muted">{strings.list.languages}</div>
          <div className="flex flex-wrap gap-2">
            {languages.map((language) => {
              const on = langs.includes(language.code);
              return (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => toggle(language.code)}
                  className={`cursor-pointer border px-3 py-1.5 font-mono text-[13px] transition-colors ${
                    on ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-fg"
                  }`}
                >
                  {language.nativeName}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3.5">
          <div className="font-mono text-[11px] text-muted">{strings.list.engine}</div>
          <select
            value={engine}
            onChange={(event) => setEngine(event.target.value as EngineId)}
            className="border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px] outline-none"
          >
            {engines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.configured ? "" : ` (${strings.list.engineNoKey})`}
              </option>
            ))}
          </select>
          <EngineKeysDialog
            strings={strings.keys}
            engines={engines.map((item) => ({ id: item.id, label: item.label }))}
            initial={engineKeys}
            onChange={(status) =>
              setEngines((prev) =>
                prev.map((item) =>
                  item.id === status.engine ? { ...item, configured: status.configured } : item,
                ),
              )
            }
          />
        </div>

        {error ? <div className="font-mono text-[12px]">{error}</div> : null}

        <div>
          <button
            type="button"
            onClick={() => void create()}
            disabled={pending}
            className="cursor-pointer border border-fg px-6 py-2.5 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
          >
            {pending ? strings.list.creating : strings.list.create}
          </button>
        </div>
      </div>

      <Section title={strings.list.active} empty={strings.list.noActive} count={open.length}>
        {open.map((meeting) => (
          <button
            key={meeting.id}
            type="button"
            onClick={() => router.push(`/admin/meetings/${meeting.id}`)}
            className="flex w-full cursor-pointer items-baseline justify-between gap-4 border-t border-line py-4 text-left hover:opacity-60"
          >
            <span className="app-text">{meeting.title}</span>
            <span className="shrink-0 font-mono text-[12px] whitespace-nowrap text-muted">
              {nameList(meeting.langs)} · {formatTimestamp(meeting.createdAt)} ·{" "}
              {strings.list.active} →
            </span>
          </button>
        ))}
      </Section>

      <Section title={strings.list.closed} empty={strings.list.noClosed} count={closed.length}>
        {closed.map((meeting) => (
          <button
            key={meeting.id}
            type="button"
            onClick={() => router.push(`/admin/meetings/${meeting.id}`)}
            className="flex w-full cursor-pointer items-baseline justify-between gap-4 border-t border-line py-4 text-left text-muted hover:opacity-60"
          >
            <span className="app-text">{meeting.title}</span>
            <span className="shrink-0 font-mono text-[12px] whitespace-nowrap">
              {nameList(meeting.langs)} · {formatTimestamp(meeting.createdAt)}
            </span>
          </button>
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-8">
      <div className="mb-1.5 font-mono text-[11px] text-muted">{title}</div>
      {count === 0 ? <p className="py-4 font-mono text-[12px] text-muted">{empty}</p> : children}
    </div>
  );
}
