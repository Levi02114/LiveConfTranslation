"use client";

import { useId, useRef, useState } from "react";

import type { AdminStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";

export function MinutesDownloadButtons({
  meetingId,
  languages,
  strings,
  buttonClass,
  defaultSelected,
}: {
  meetingId: string;
  languages: Language[];
  strings: AdminStrings["log"];
  buttonClass: string;
  defaultSelected?: readonly LanguageCode[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [format, setFormat] = useState<"txt" | "pdf">("txt");
  const [selected, setSelected] = useState<LanguageCode[]>([]);

  const open = (nextFormat: "txt" | "pdf") => {
    setFormat(nextFormat);
    setSelected(defaultSelected ? [...defaultSelected] : languages.map((language) => language.code));
    dialogRef.current?.showModal();
  };
  const toggle = (code: LanguageCode) => {
    setSelected((current) =>
      current.includes(code) ? current.filter((value) => value !== code) : [...current, code],
    );
  };
  const params = new URLSearchParams({ format, translations: selected.join(",") });

  return (
    <>
      <button type="button" onClick={() => open("txt")} className={buttonClass}>
        {strings.download}
      </button>
      <button type="button" onClick={() => open("pdf")} className={buttonClass}>
        {strings.downloadPdf}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(430px,calc(100vw-32px))] overflow-y-auto border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="p-5 sm:p-6">
          <div id={titleId} className="font-mono text-[13px]">{strings.selectTranslations}</div>
          <p className="mt-2 font-mono text-[11px] leading-[1.6] text-muted">
            {strings.sourcesAlwaysIncluded}
          </p>
          <div className="mt-4 max-h-[45dvh] space-y-1 overflow-y-auto border-y border-line py-2">
            {languages.map((language) => (
              <label
                key={language.code}
                className="flex min-h-10 cursor-pointer items-center gap-3 px-2 font-mono text-[13px] hover:bg-panel"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(language.code)}
                  onChange={() => toggle(language.code)}
                  className="h-4 w-4 accent-[var(--fg)]"
                />
                <span>{language.label}</span>
              </label>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer border border-line px-3 py-2 font-mono text-[12px] text-muted hover:border-fg hover:text-fg"
            >
              {strings.cancel}
            </button>
            <a
              href={`/api/meetings/${meetingId}/log?${params}`}
              download
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer border border-fg px-3 py-2 font-mono text-[12px] hover:bg-fg hover:text-bg"
            >
              {format === "pdf" ? strings.downloadPdf : strings.download}
            </a>
          </div>
        </div>
      </dialog>
    </>
  );
}
