"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { EngineKeysDialog, type EngineKeyStatus } from "./engine-keys-dialog";
import { getStrings } from "@/lib/i18n";
import type { Language, LanguageCode } from "@/lib/languages";
import { formatTimestamp } from "@/lib/log-format";
import type { Meeting } from "@/lib/repo";
import type { EngineId } from "@/lib/translate/types";

const strings = getStrings("ko");

type Row = Meeting & { langs: LanguageCode[] };

export function MeetingList({
  meetings,
  languages,
  defaultLangs,
  engines: initialEngines,
  engineKeys,
  defaultEngine,
}: {
  meetings: Row[];
  languages: Language[];
  defaultLangs: LanguageCode[];
  engines: { id: EngineId; label: string; configured: boolean }[];
  engineKeys: EngineKeyStatus[];
  defaultEngine: EngineId;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [langs, setLangs] = useState<LanguageCode[]>(defaultLangs);
  const [engine, setEngine] = useState<EngineId>(defaultEngine);
  // 키를 등록하면 "(키 없음)" 표시가 즉시 사라져야 한다.
  const [engines, setEngines] = useState(initialEngines);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const toggle = (code: LanguageCode) => {
    setLangs((prev) =>
      prev.includes(code) ? prev.filter((value) => value !== code) : [...prev, code],
    );
  };

  const create = async () => {
    if (pending) return;
    if (!title.trim()) {
      setError("회의 제목을 입력해 주세요");
      return;
    }
    if (langs.length < 2) {
      setError("서로 다른 언어를 두 개 이상 골라 주세요");
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
      const payload = (await response.json()) as {
        meeting?: Meeting;
        error?: string;
      };

      if (!response.ok || !payload.meeting) {
        setError(payload.error ?? "회의를 만들지 못했습니다");
        return;
      }
      router.push(`/admin/meetings/${payload.meeting.id}`);
    } catch {
      setError("회의를 만들지 못했습니다");
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

  const label = (codes: LanguageCode[]) =>
    codes
      .map((code) => languages.find((language) => language.code === code)?.label ?? code)
      .join(" · ");

  return (
    <div className="mx-auto max-w-[840px] px-8 pt-20 pb-16">
      <AppearanceControls strings={strings.appearance} textSize={false} />

      <div className="flex items-baseline justify-between gap-4">
        <div className="font-mono text-[12px] tracking-[0.04em] text-muted">회의</div>
        <button
          type="button"
          onClick={() => void logout()}
          className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
        >
          로그아웃
        </button>
      </div>

      <div className="flex flex-col gap-6 border-b border-line pt-6 pb-9">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="회의 제목"
          className="border-0 border-b border-line bg-transparent py-1.5 text-[24px] outline-none focus:border-fg"
        />

        <div>
          <div className="mb-2.5 font-mono text-[11px] text-muted">언어</div>
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
                  {language.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3.5">
          <div className="font-mono text-[11px] text-muted">번역 엔진</div>
          <select
            value={engine}
            onChange={(event) => setEngine(event.target.value as EngineId)}
            className="border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px] outline-none"
          >
            {engines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.configured ? "" : " (키 없음)"}
              </option>
            ))}
          </select>
          <EngineKeysDialog
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
            {pending ? "만드는 중" : "회의 만들기"}
          </button>
        </div>
      </div>

      <Section title="진행 중" empty="진행 중인 회의가 없습니다">
        {open.map((meeting) => (
          <button
            key={meeting.id}
            type="button"
            onClick={() => router.push(`/admin/meetings/${meeting.id}`)}
            className="flex w-full cursor-pointer items-baseline justify-between gap-4 border-t border-line py-4 text-left hover:opacity-60"
          >
            <span className="text-[19px]">{meeting.title}</span>
            <span className="shrink-0 font-mono text-[12px] whitespace-nowrap text-muted">
              {label(meeting.langs)} · {formatTimestamp(meeting.createdAt)} · 진행 중 →
            </span>
          </button>
        ))}
      </Section>

      <Section title="종료됨" empty="종료된 회의가 없습니다">
        {closed.map((meeting) => (
          <button
            key={meeting.id}
            type="button"
            onClick={() => router.push(`/admin/meetings/${meeting.id}`)}
            className="flex w-full cursor-pointer items-baseline justify-between gap-4 border-t border-line py-4 text-left text-muted hover:opacity-60"
          >
            <span className="text-[19px]">{meeting.title}</span>
            <span className="shrink-0 font-mono text-[12px] whitespace-nowrap">
              {label(meeting.langs)} · {formatTimestamp(meeting.createdAt)}
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
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.filter(Boolean).length === 0;

  return (
    <div className="pt-8">
      <div className="mb-1.5 font-mono text-[11px] text-muted">{title}</div>
      {isEmpty ? <p className="py-4 font-mono text-[12px] text-muted">{empty}</p> : children}
    </div>
  );
}
