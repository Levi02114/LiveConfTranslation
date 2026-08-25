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
const catalogResponseSchema = z.object({
  catalog: z.array(z.object({
    code: z.string(),
    label: z.string(),
    nativeName: z.string(),
    logName: z.string(),
    builtin: z.boolean(),
    engines: z.record(z.string(), z.boolean()),
  })).optional(),
});
const addResponseSchema = z.object({ failed: z.number().optional(), error: z.string().optional() });

/**
 * 언어 추가.
 *
 * 고를 수 있는 언어가 130개라 목록만으로는 못 찾는다. 검색이 본체고 목록은 그
 * 결과다. 코드·원어 이름·표시 언어 이름·영어 이름을 모두 훑으므로
 * `japanese` 로도 `일본어` 로도 `日本語` 로도 찾힌다.
 *
 * 추가하면 서버가 **UI 문구까지 그 자리에서 번역한다.** 90여 개를 옮기는
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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LanguageCode | null>(null);
  const [engine, setEngine] = useState<EngineId>(defaultEngine);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const open = async () => {
    dialogRef.current?.showModal();
    if (loaded) return;

    try {
      const response = await fetch(
        `/api/admin/languages?display=${encodeURIComponent(display)}`,
      );
      const payload = await parseJsonResponse(response, catalogResponseSchema);
      setCatalog(payload?.catalog ?? []);
      setLoaded(true);
    } catch {
      setError(strings.addFailed);
    }
  };

  const add = async () => {
    if (!selected || pending) return;

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
        setError(`${strings.partial}: ${payload.failed}`);
      } else {
        dialogRef.current?.close();
      }

      setCatalog((prev) => prev.filter((item) => item.code !== selected));
      setSelected(null);
      onAdded();
    } catch {
      setError(strings.addFailed);
    } finally {
      setPending(false);
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
        className="grid h-[18px] w-[25px] cursor-pointer place-items-center border border-line p-0 leading-none text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
      >
        ＋
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => {
          setQuery("");
          setSelected(null);
          setError(null);
        }}
        className="m-auto w-[min(560px,calc(100vw-32px))] border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-7 py-6">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[12px] tracking-[0.04em] text-muted">
              {strings.add}
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer font-mono text-[12px] text-muted hover:text-fg"
            >
              {strings.close}
            </button>
          </div>

          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.search}
            className="mt-4 w-full border-0 border-b border-line bg-transparent py-1.5 text-[15px] outline-none focus:border-fg"
          />

          {error ? <div className="mt-3 font-mono text-[12px]">{error}</div> : null}

          <div className="mt-3 max-h-[46vh] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="py-6 font-mono text-[12px] text-muted">{strings.noResults}</p>
            ) : (
              visible.map((item) => {
                const on = selected === item.code;
                const unsupported = !item.engines[engine];
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setSelected(item.code)}
                    className={`flex w-full items-baseline justify-between gap-3 border-t border-line px-2 py-2.5 text-left transition-colors ${
                      on ? "bg-fg text-bg" : "cursor-pointer hover:opacity-60"
                    }`}
                  >
                    <span className="text-[15px]">{item.nativeName}</span>
                    <span className="shrink-0 font-mono text-[11px] whitespace-nowrap opacity-70">
                      {item.label} · {item.code}
                      {unsupported ? ` · ${strings.unsupported}` : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <div className="font-mono text-[11px] text-muted">{strings.translateWith}</div>
            <select
              value={engine}
              onChange={(event) => {
                if (isEngineId(event.target.value)) setEngine(event.target.value);
              }}
              className="border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px] outline-none"
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
              disabled={!selected || pending}
              className="cursor-pointer border border-fg px-4 py-1.5 font-mono text-[12px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
            >
              {pending ? strings.adding : strings.confirm}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
