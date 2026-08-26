"use client";

import { useRef, useState } from "react";
import { z } from "zod";

import type { AdminStrings } from "@/lib/i18n-builtin";
import { parseJsonResponse } from "@/lib/json-response";
import { formatTimestamp } from "@/lib/log-format";

const statusSchema = z.object({
  configured: z.boolean(),
  hint: z.string().nullable(),
  updatedAt: z.number().nullable(),
});
export type GoogleSpeechStatus = z.infer<typeof statusSchema>;
const responseSchema = z.object({
  credentials: statusSchema.optional(),
  error: z.string().optional(),
});

export function GoogleSpeechDialog({
  strings,
  initial,
}: {
  strings: AdminStrings["speechCredentials"];
  initial: GoogleSpeechStatus;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState(initial);
  const [draft, setDraft] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/google-speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentials: draft }),
      });
      const payload = await parseJsonResponse(response, responseSchema);
      if (!response.ok || !payload?.credentials) {
        setError(response.status === 400 ? strings.invalidFile : strings.saveFailed);
        return;
      }
      setStatus(payload.credentials);
      setDraft("");
      setFileName("");
    } catch {
      setError(strings.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/google-speech", { method: "DELETE" });
      const payload = await parseJsonResponse(response, responseSchema);
      if (!response.ok || !payload?.credentials) {
        setError(strings.removeFailed);
        return;
      }
      setStatus(payload.credentials);
    } catch {
      setError(strings.removeFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="cursor-pointer border border-line px-2.5 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
      >
        {strings.button}
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => {
          setDraft("");
          setFileName("");
          setError(null);
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-7 py-6">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[12px] tracking-[0.04em] text-muted">{strings.title}</div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer font-mono text-[12px] text-muted hover:text-fg"
            >
              {strings.close}
            </button>
          </div>
          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">{strings.note}</p>
          <div className="mt-5 border-t border-line py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-[15px]">{strings.engineLabel}</span>
              <span className="font-mono text-[11px] text-muted">
                {status.configured ? `${status.hint} · ${strings.registered}` : strings.none}
              </span>
            </div>
            {status.updatedAt ? (
              <div className="mt-1 font-mono text-[11px] text-muted">{formatTimestamp(status.updatedAt)}</div>
            ) : null}
            {error ? <div className="mt-3 font-mono text-[12px]">{error}</div> : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="cursor-pointer border border-line px-3 py-1.5 font-mono text-[12px] hover:border-fg">
                {strings.chooseFile}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setFileName(file.name);
                    setError(null);
                    void file.text().then(setDraft).catch(() => setError(strings.invalidFile));
                  }}
                />
              </label>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                {fileName || strings.noFile}
              </span>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!draft || busy}
                className="cursor-pointer border border-fg px-3.5 py-1.5 font-mono text-[12px] hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
              >
                {busy ? strings.saving : strings.save}
              </button>
              {status.configured ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="cursor-pointer border border-line px-3 py-1.5 font-mono text-[12px] text-muted hover:border-fg hover:bg-fg hover:text-bg disabled:opacity-30"
                >
                  {strings.remove}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
