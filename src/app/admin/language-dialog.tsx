"use client";

import { useRef, useState } from "react";
import { z } from "zod";

import type { AdminStrings } from "@/lib/i18n-builtin";
import { parseJsonResponse } from "@/lib/json-response";
import { matchesLanguageQuery } from "@/lib/language-catalog";
import type { Language, LanguageCode } from "@/lib/languages";
import { isEngineId, type EngineId } from "@/lib/translate/types";

/** `/api/admin/languages` 가 내려 주는 한 줄 */
export type CatalogLanguage = Language & {
  builtin: boolean;
  /** 엔진별 지원 여부. */
  engines: Record<string, boolean>;
};
const languageSchema = z.object({
  code: z.string(),
  label: z.string(),
  nativeName: z.string(),
  logName: z.string(),
  builtin: z.boolean(),
  engines: z.record(z.string(), z.boolean()),
});
const catalogResponseSchema = z.object({
  catalog: z.array(languageSchema),
  languages: z.array(languageSchema),
});
const addResponseSchema = z.object({ failed: z.number().optional(), error: z.string().optional() });

/**
 * 언어 추가.
 *
 * 고를 수 있는 언어가 130개라 목록만으로는 못 찾는다. 검색이 본체고 목록은 그
 * 결과다. 코드·원어 이름·표시 언어 이름·영어 이름을 모두 훑으므로
 * `japanese` 로도 `일본어` 로도 `日本語` 로도 찾힌다.
 *
 * 추가하면 서버가 **UI 문구까지 그 자리에서 번역한다.** 문구를 옮기는
 * 동안(엔진에 따라 수 초~수십 초) 창을 열어 둔 채 기다린다.
 */
export function LanguageDialog({
  strings,
  display,
  engines,
  defaultEngine,
  onAdded,
}: {
  strings: AdminStrings["languages"];
  /** 언어 이름을 어느 언어로 쓸지. 관리자 화면의 표시 언어. */
  display: LanguageCode;
  engines: { id: EngineId; label: string; configured: boolean }[];
  defaultEngine: EngineId;
  onAdded: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [catalog, setCatalog] = useState<CatalogLanguage[]>([]);
  const [registered, setRegistered] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LanguageCode | null>(null);
  const [engine, setEngine] = useState<EngineId>(defaultEngine);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/languages?display=${encodeURIComponent(display)}`,
        { cache: "no-store" },
      );
      const payload = await parseJsonResponse(response, catalogResponseSchema);
      if (!response.ok || !payload) throw new Error("language-list-unavailable");
      setCatalog([...payload.catalog, ...payload.languages]);
      setRegistered(payload.languages.map((item) => item.code));
    } catch {
      setError(strings.addFailed);
    } finally {
      setLoading(false);
    }
  };

  const open = async () => {
    setError(null);
    dialogRef.current?.showModal();
    await load();
  };

  const add = async () => {
    if (!selected || pending || loading || registered.includes(selected)) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/languages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: selected, engine }),
      });
      const payload = await parseJsonResponse(response, addResponseSchema);

      if (!response.ok || !payload) {
        setError(strings.addFailed);
        return;
      }

      // 일부만 옮겨졌으면 알려 준다. 나머지는 화면에서 한국어로 나온다.
      if (payload.failed) {
        setError(`${strings.translationIncomplete} ${strings.partial}: ${payload.failed}`);
      } else {
        dialogRef.current?.close();
      }

      setRegistered((prev) => [...prev, selected]);
      setSelected(null);
    } catch {
      setError(strings.addFailed);
    } finally {
      setPending(false);
      // A failed/timed-out response may still have registered the language.
      onAdded();
      await load();
    }
  };

  const visible = catalog.filter((item) => matchesLanguageQuery(item, query));

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        title={strings.add}
        aria-label={strings.add}
        className="grid min-h-[1.125rem] min-w-[1.5625rem] cursor-pointer place-items-center border border-line p-0 leading-none text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
      >
        ＋
      </button>

      <dialog
        ref={dialogRef}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClose={() => {
          setQuery("");
          setSelected(null);
          setError(null);
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-32px))] overflow-y-auto border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-7 py-6">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[0.75rem] tracking-[0.04em] text-muted">
              {strings.add}
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={pending}
              className="cursor-pointer font-mono text-[0.75rem] text-muted hover:text-fg disabled:opacity-30"
            >
              {strings.close}
            </button>
          </div>

          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.search}
            aria-label={strings.search}
            className="mt-4 w-full border-0 border-b border-line bg-transparent py-1.5 text-[0.9375rem] outline-none focus:border-fg"
          />

          {error ? <div role="status" className="mt-3 font-mono text-[0.75rem]">{error}</div> : null}

          <div className="mt-3 max-h-[46vh] overflow-y-auto">
            {loading ? (
              <p role="status" className="py-6 font-mono text-[0.75rem] text-muted">{strings.loading}</p>
            ) : visible.length === 0 ? (
              <p className="py-6 font-mono text-[0.75rem] text-muted">{strings.noResults}</p>
            ) : (
              visible.map((item) => {
                const on = selected === item.code;
                const unsupported = !item.engines[engine];
                const added = registered.includes(item.code);
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setSelected(item.code)}
                    disabled={added || pending}
                    className={`flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line px-2 py-2.5 text-left break-words transition-colors disabled:cursor-default ${
                      on ? "bg-fg text-bg" : "cursor-pointer hover:opacity-60"
                    }`}
                  >
                    <span className="min-w-0 text-[0.9375rem]">{item.nativeName}</span>
                    <span className="min-w-0 font-mono text-[0.6875rem] opacity-70">
                      {item.label} · {item.code}
                      {added ? ` · ${strings.registered}` : ""}
                      {unsupported ? ` · ${strings.unsupported}` : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <div className="font-mono text-[0.6875rem] text-muted">{strings.translateWith}</div>
            <select
              value={engine}
              disabled={pending}
              aria-label={strings.translateWith}
              onChange={(event) => {
                if (isEngineId(event.target.value)) setEngine(event.target.value);
              }}
              className="max-w-full border border-line bg-bg px-2.5 py-1.5 font-mono text-[0.8125rem] outline-none"
            >
              {engines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void add()}
              disabled={!selected || pending || loading || registered.includes(selected)}
              className="cursor-pointer border border-fg px-4 py-1.5 font-mono text-[0.75rem] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
            >
              {pending ? strings.adding : strings.confirm}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
