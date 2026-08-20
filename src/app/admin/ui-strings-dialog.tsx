"use client";

import { useRef, useState } from "react";
import { z } from "zod";

import type { AdminStrings } from "@/lib/i18n-builtin";
import { parseJsonResponse } from "@/lib/json-response";
import type { Language, LanguageCode } from "@/lib/languages";
import { isEngineId, type EngineId } from "@/lib/translate/types";

/** `/api/admin/ui-strings` 가 내려 주는 한 줄 */
export type StringRow = {
  key: string;
  /** 한국어 원문. 무엇을 옮긴 것인지 보여 주는 기준이다. */
  source: string;
  text: string;
  origin: "manual" | "machine" | "builtin" | "fallback";
};
const stringsResponseSchema = z.object({
  entries: z.array(z.object({
    key: z.string(),
    source: z.string(),
    text: z.string(),
    origin: z.enum(["manual", "machine", "builtin", "fallback"]),
  })).optional(),
  failed: z.number().optional(),
  error: z.string().optional(),
});

/**
 * UI 문구 수정.
 *
 * 기계 번역은 라벨을 문장으로 늘리거나("저장" → "이것을 저장하십시오") 엉뚱한
 * 낱말을 고른다. 고칠 수단이 없으면 언어 추가 기능을 실제 행사에 쓸 수 없다.
 *
 * 왼쪽에 한국어 원문을 같이 두는 이유: 번역문만 봐서는 그게 어느 버튼의 글자인지
 * 알 수 없다. 키(`admin.list.create`)와 원문을 함께 봐야 판단이 선다.
 *
 * 고친 문구는 `manual` 로 표시되어 「다시 번역」이 덮어쓰지 못한다.
 */
export function UiStringsDialog({
  strings,
  languages,
  initialLang,
  engines,
  defaultEngine,
  onSaved,
}: {
  strings: AdminStrings["strings"];
  languages: readonly Language[];
  initialLang: LanguageCode;
  engines: { id: EngineId; label: string; configured: boolean }[];
  defaultEngine: EngineId;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [lang, setLang] = useState<LanguageCode>(initialLang);
  const [rows, setRows] = useState<StringRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<EngineId>(defaultEngine);
  const [busy, setBusy] = useState<"save" | "retranslate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (target: LanguageCode) => {
    setError(null);
    setDrafts({});
    try {
      const response = await fetch(`/api/admin/ui-strings?lang=${encodeURIComponent(target)}`);
      const payload = await parseJsonResponse(response, stringsResponseSchema);

      if (!response.ok || !payload) {
        setError(strings.saveFailed);
        return;
      }
      setRows(payload.entries ?? []);
    } catch {
      setError(strings.saveFailed);
    }
  };

  const open = () => {
    dialogRef.current?.showModal();
    void load(lang);
  };

  const changed = Object.entries(drafts).filter(([key, text]) => {
    const row = rows.find((item) => item.key === key);
    return row && text.trim() && text !== row.text;
  });

  const save = async () => {
    if (busy) return;
    if (changed.length === 0) {
      setError(strings.noChanges);
      return;
    }

    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/admin/ui-strings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lang,
          entries: changed.map(([key, text]) => ({ key, text })),
        }),
      });
      const payload = await parseJsonResponse(response, stringsResponseSchema);

      if (!response.ok || !payload) {
        setError(strings.saveFailed);
        return;
      }
      setRows(payload.entries ?? []);
      setDrafts({});
      onSaved();
    } catch {
      setError(strings.saveFailed);
    } finally {
      setBusy(null);
    }
  };

  /** 되돌리기. 저장된 행을 지우면 빌트인 문구(없으면 한국어)가 다시 보인다. */
  const revert = async (key: string) => {
    if (busy) return;

    setError(null);
    try {
      const response = await fetch(
        `/api/admin/ui-strings?lang=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
      const payload = await parseJsonResponse(response, stringsResponseSchema);

      if (!response.ok || !payload) {
        setError(strings.saveFailed);
        return;
      }
      setRows(payload.entries ?? []);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      onSaved();
    } catch {
      setError(strings.saveFailed);
    }
  };

  const retranslate = async () => {
    if (busy) return;

    setBusy("retranslate");
    setError(null);
    try {
      const response = await fetch("/api/admin/ui-strings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang, engine }),
      });
      const payload = await parseJsonResponse(response, stringsResponseSchema);

      if (!response.ok || !payload) {
        setError(strings.saveFailed);
        return;
      }
      setRows(payload.entries ?? []);
      setDrafts({});
      onSaved();
    } catch {
      setError(strings.saveFailed);
    } finally {
      setBusy(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((row) =>
        [row.key, row.source, row.text].some((value) => value.toLowerCase().includes(needle)),
      )
    : rows;

  return (
    <>
      <button
        type="button"
        onClick={open}
        title={strings.button}
        aria-label={strings.button}
        className="cursor-pointer border border-line px-1.5 leading-none text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
      >
        ⚙
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => {
          setQuery("");
          setDrafts({});
          setError(null);
        }}
        className="m-auto w-[min(760px,calc(100vw-32px))] border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-7 py-6">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[12px] tracking-[0.04em] text-muted">
              {strings.title}
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer font-mono text-[12px] text-muted hover:text-fg"
            >
              {strings.close}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select
              value={lang}
              onChange={(event) => {
                setLang(event.target.value);
                void load(event.target.value);
              }}
              className="border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px] outline-none"
            >
              {languages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.nativeName}
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.search}
              className="min-w-0 flex-1 border-0 border-b border-line bg-transparent py-1.5 text-[14px] outline-none focus:border-fg"
            />
          </div>

          {error ? <div className="mt-3 font-mono text-[12px]">{error}</div> : null}

          <div className="mt-3 max-h-[52vh] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="py-6 font-mono text-[12px] text-muted">{strings.empty}</p>
            ) : (
              visible.map((row) => {
                const draft = drafts[row.key] ?? row.text;
                return (
                  <div key={row.key} className="border-t border-line py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[11px] text-muted">{row.key}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted">
                        {row.origin === "manual" ? strings.manual : null}
                      </span>
                    </div>
                    <div className="mt-1 text-[13px] text-muted">{row.source}</div>
                    <div className="mt-1.5 flex items-end gap-3">
                      <input
                        value={draft}
                        onChange={(event) =>
                          setDrafts((prev) => ({ ...prev, [row.key]: event.target.value }))
                        }
                        className="min-w-0 flex-1 border-0 border-b border-line bg-transparent py-1 text-[15px] outline-none focus:border-fg"
                      />
                      {row.origin === "manual" || row.origin === "machine" ? (
                        <button
                          type="button"
                          onClick={() => void revert(row.key)}
                          className="shrink-0 cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
                        >
                          {strings.revert}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== null || changed.length === 0}
              className="cursor-pointer border border-fg px-4 py-1.5 font-mono text-[12px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
            >
              {busy === "save" ? strings.saving : strings.save}
            </button>

            <div className="ml-auto flex items-center gap-3">
              <select
                value={engine}
                onChange={(event) => {
                  if (isEngineId(event.target.value)) setEngine(event.target.value);
                }}
                className="border border-line bg-bg px-2.5 py-1.5 font-mono text-[12px] outline-none"
              >
                {engines.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void retranslate()}
                disabled={busy !== null}
                className="cursor-pointer border border-line px-3 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
              >
                {busy === "retranslate" ? strings.retranslating : strings.retranslate}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
