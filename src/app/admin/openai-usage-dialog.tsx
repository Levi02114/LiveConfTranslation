"use client";

import { useRef, useState } from "react";
import { z } from "zod";

import type { AdminStrings } from "@/lib/i18n-builtin";
import { parseJsonResponse } from "@/lib/json-response";
import { usagePeriodSchema, type UsagePeriod } from "@/lib/openai-usage";

const statusSchema = z.object({
  configured: z.boolean(),
  hint: z.string().nullable(),
  updatedAt: z.number().nullable(),
});
const responseSchema = z.object({
  status: statusSchema.optional(),
  rows: z.array(z.object({
    model: z.string(),
    inputTokens: z.number(),
    cachedInputTokens: z.number(),
    outputTokens: z.number(),
    requests: z.number(),
    estimatedCostUsd: z.number().nullable(),
  })).optional(),
  error: z.string().optional(),
});
type UsageResponse = z.infer<typeof responseSchema>;

export function OpenaiUsageDialog({ strings }: { strings: AdminStrings["openaiUsage"] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [period, setPeriod] = useState<UsagePeriod>("day");
  const [status, setStatus] = useState<z.infer<typeof statusSchema> | null>(null);
  const [rows, setRows] = useState<NonNullable<UsageResponse["rows"]>>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errorText = (code: string | undefined) => {
    if (code === "key-required") return strings.keyRequired;
    if (code === "key-invalid") return strings.keyInvalid;
    if (code === "permission-denied") return strings.permissionDenied;
    if (code === "rate-limited") return strings.rateLimited;
    return strings.loadFailed;
  };

  const load = async (nextPeriod: UsagePeriod) => {
    setPeriod(nextPeriod);
    setBusy("load");
    setError(null);
    try {
      const response = await fetch(`/api/admin/openai-usage?period=${nextPeriod}`);
      const payload = await parseJsonResponse(response, responseSchema);
      if (payload?.status) setStatus(payload.status);
      if (!response.ok || !payload?.rows) {
        setRows([]);
        setError(errorText(payload?.error));
        return;
      }
      setRows(payload.rows);
    } catch {
      setError(strings.loadFailed);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const key = draft.trim();
    if (!key || busy) return;
    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/admin/openai-usage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const payload = await parseJsonResponse(response, responseSchema);
      if (!response.ok || !payload?.status) {
        setError(strings.saveFailed);
        return;
      }
      setStatus(payload.status);
      setDraft("");
      await load(period);
    } catch {
      setError(strings.saveFailed);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy("delete");
    setError(null);
    try {
      const response = await fetch("/api/admin/openai-usage", { method: "DELETE" });
      const payload = await parseJsonResponse(response, responseSchema);
      if (!response.ok || !payload?.status) {
        setError(strings.removeFailed);
        return;
      }
      setStatus(payload.status);
      setRows([]);
      setDraft("");
    } catch {
      setError(strings.removeFailed);
    } finally {
      setBusy(null);
    }
  };

  const tokens = new Intl.NumberFormat().format;
  const dollars = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialogRef.current?.showModal();
          void load(period);
        }}
        className="cursor-pointer border border-line px-2.5 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
      >
        {strings.button}
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => {
          setDraft("");
          setError(null);
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] overflow-y-auto border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-5 py-5 sm:px-7 sm:py-6">
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
          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">{strings.description}</p>

          <div className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="openai-admin-key" className="font-mono text-[11px] text-muted">
                {strings.adminKey}
              </label>
              <span className="font-mono text-[11px] text-muted">
                {status?.configured ? `${status.hint} · ${strings.configured}` : strings.notConfigured}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <input
                id="openai-admin-key"
                type="password"
                autoComplete="off"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={status?.configured ? strings.replacePlaceholder : strings.placeholder}
                className="min-w-[180px] flex-1 border-0 border-b border-line bg-transparent py-1.5 font-mono text-[13px] outline-none focus:border-fg"
              />
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy !== null || !draft.trim()}
                className="cursor-pointer border border-fg px-3 py-1.5 font-mono text-[12px] hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
              >
                {busy === "save" ? strings.saving : strings.save}
              </button>
              {status?.configured ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy !== null}
                  className="cursor-pointer border border-line px-3 py-1.5 font-mono text-[12px] text-muted hover:border-fg hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
                >
                  {strings.remove}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row" role="group" aria-label={strings.period}>
            {usagePeriodSchema.options.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => void load(value)}
                disabled={busy !== null}
                className={`cursor-pointer border px-3 py-1.5 font-mono text-[12px] ${period === value ? "border-fg bg-fg text-bg" : "border-line text-muted"}`}
              >
                {value === "day" ? strings.daily : strings.weekly}
              </button>
            ))}
          </div>

          {error ? <div className="mt-4 font-mono text-[12px] leading-5">{error}</div> : null}
          {busy === "load" ? <div className="mt-5 font-mono text-[12px] text-muted">{strings.loading}</div> : null}
          {busy !== "load" && !error && rows.length === 0 ? (
            <div className="mt-5 font-mono text-[12px] text-muted">{strings.empty}</div>
          ) : null}

          <div className="mt-4 grid gap-3">
            {rows.map((row) => (
              <section key={row.model} className="border border-line p-4">
                <h3 className="break-all font-mono text-[13px]">{row.model}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-5">
                  <div><dt className="text-muted">{strings.input}</dt><dd className="mt-1">{tokens(row.inputTokens)}</dd></div>
                  <div><dt className="text-muted">{strings.cached}</dt><dd className="mt-1">{tokens(row.cachedInputTokens)}</dd></div>
                  <div><dt className="text-muted">{strings.output}</dt><dd className="mt-1">{tokens(row.outputTokens)}</dd></div>
                  <div><dt className="text-muted">{strings.requests}</dt><dd className="mt-1">{tokens(row.requests)}</dd></div>
                  <div><dt className="text-muted">{strings.cost}</dt><dd className="mt-1">{row.estimatedCostUsd === null ? strings.unknownCost : dollars(row.estimatedCostUsd)}</dd></div>
                </dl>
              </section>
            ))}
          </div>

          <p className="mt-5 font-mono text-[10px] leading-[1.7] text-muted">{strings.organizationNote}</p>
          <p className="mt-2 font-mono text-[10px] leading-[1.7] text-muted">{strings.pricingNote}</p>
        </div>
      </dialog>
    </>
  );
}
