"use client";

import { useRef, useState } from "react";

import type { AdminStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";

type GlossaryRow = {
  id?: string;
  clientId: string;
  terms: Record<LanguageCode, string>;
};

let newRow = 0;

export function GlossaryDialog({
  strings,
  languages,
  displayLang,
}: {
  strings: AdminStrings["glossary"];
  languages: readonly Language[];
  displayLang: LanguageCode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<GlossaryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderedLanguages = [
    ...languages.filter((language) => language.code === displayLang),
    ...languages.filter((language) => language.code !== displayLang),
  ];

  const load = async () => {
    setError(null);
    try {
      const response = await fetch("/api/admin/glossary");
      const payload = (await response.json()) as {
        entries?: { id: string; terms: Record<LanguageCode, string> }[];
      };
      if (!response.ok) throw new Error();
      setRows(
        (payload.entries ?? []).map((entry) => ({
          ...entry,
          clientId: entry.id,
        })),
      );
    } catch {
      setError(strings.saveFailed);
    }
  };

  const open = () => {
    dialogRef.current?.showModal();
    void load();
  };

  const add = () => {
    newRow += 1;
    setRows((current) => [
      {
        clientId: `new-${Date.now()}-${newRow}`,
        terms: Object.fromEntries(languages.map((language) => [language.code, ""])),
      },
      ...current,
    ]);
  };

  const save = async () => {
    if (busy) return;
    if (rows.some((row) => languages.some((language) => !row.terms[language.code]?.trim()))) {
      setError(strings.required);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/glossary", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: rows.map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            terms: languages.map((language) => ({
              lang: language.code,
              term: row.terms[language.code].trim(),
            })),
          })),
        }),
      });
      const payload = (await response.json()) as {
        entries?: { id: string; terms: Record<LanguageCode, string> }[];
      };
      if (!response.ok || !payload.entries) throw new Error();
      setRows(payload.entries.map((entry) => ({ ...entry, clientId: entry.id })));
    } catch {
      setError(strings.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        title={strings.button}
        aria-label={strings.button}
        className="grid h-[18px] w-[25px] cursor-pointer place-items-center border border-line text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current">
          <path d="M3.5 5.5c3.2-.8 6-.3 8.5 1.5v12c-2.5-1.8-5.3-2.3-8.5-1.5zM20.5 5.5c-3.2-.8-6-.3-8.5 1.5v12c2.5-1.8 5.3-2.3 8.5-1.5z" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setError(null)}
        className="m-auto w-[min(780px,calc(100vw-32px))] border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="font-mono text-[12px] tracking-[0.04em] text-muted">
              {strings.title}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={add}
                title={strings.add}
                aria-label={strings.add}
                className="grid h-7 w-7 cursor-pointer place-items-center border border-line font-mono text-[16px] hover:border-fg hover:bg-fg hover:text-bg"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                className="cursor-pointer font-mono text-[12px] text-muted hover:text-fg"
              >
                {strings.close}
              </button>
            </div>
          </div>

          <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
            {strings.providerNote}
          </p>
          {error ? <p className="mt-3 font-mono text-[12px]">{error}</p> : null}

          <div className="mt-4 max-h-[56vh] overflow-y-auto">
            {rows.length === 0 ? (
              <p className="border-t border-line py-7 font-mono text-[12px] text-muted">
                {strings.empty}
              </p>
            ) : (
              rows.map((row) => (
                <div key={row.clientId} className="border-t border-line py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {orderedLanguages.map((language, index) => (
                      <label key={language.code} className="min-w-0">
                        <span className="font-mono text-[11px] text-muted">
                          {index === 0 ? strings.source : strings.translation} · {language.nativeName}
                        </span>
                        <input
                          value={row.terms[language.code] ?? ""}
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((item) =>
                                item.clientId === row.clientId
                                  ? {
                                      ...item,
                                      terms: {
                                        ...item.terms,
                                        [language.code]: event.target.value,
                                      },
                                    }
                                  : item,
                              ),
                            )
                          }
                          lang={language.code}
                          className="mt-1 w-full border-0 border-b border-line bg-transparent py-1.5 text-[15px] outline-none focus:border-fg"
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((item) => item.clientId !== row.clientId))}
                    className="mt-3 cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
                  >
                    {strings.remove}
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 border-t border-line pt-5">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="cursor-pointer border border-fg px-4 py-1.5 font-mono text-[12px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
            >
              {busy ? strings.saving : strings.save}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
