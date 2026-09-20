"use client";

import { useEffect, useState } from "react";
import type { AdminStrings } from "@/lib/i18n-builtin";
import { securityLimitsSchema, type SecurityLimits } from "@/lib/security-limits";

export function SecuritySettings({ initial, strings }: { initial: SecurityLimits; strings: AdminStrings["security"] }) {
  const [limits, setLimits] = useState(initial);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/admin/security", { signal: abort.signal }).then(async (response) => {
      const parsed = securityLimitsSchema.safeParse((await response.json()).limits);
      if (!response.ok || !parsed.success) throw new Error();
      setLimits(parsed.data);
    }).catch(() => { if (!abort.signal.aborted) setNotice(strings.failed); });
    return () => abort.abort();
  }, [strings.failed]);
  // SAFETY: limits originates from securityLimitsSchema and updates only its existing fields.
  const keys = Object.keys(limits) as (keyof SecurityLimits)[];
  return <details className="my-5 min-w-0 border-y border-line py-4">
    <summary className="cursor-pointer break-words">{strings.title}</summary>
    <p className="my-3 text-muted">{strings.description}</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (pending) return;
      setPending(true);
      setNotice("");
      try {
        const response = await fetch("/api/admin/security", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(limits) });
        if (!response.ok) throw new Error();
        setNotice(strings.saved);
      } catch { setNotice(strings.failed); }
      finally { setPending(false); }
    }}>
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2 disabled:opacity-60">
        {keys.map((key) => <label key={key} className="flex min-w-0 flex-col gap-2 break-words">
          <span>{strings[key]}</span>
          {/* oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Zod's public schema inspection API is named shape. */}
          <input type="number" min={1} max={securityLimitsSchema.shape[key].unwrap().maxValue ?? undefined} step={1} required
            value={Number.isNaN(limits[key]) ? "" : limits[key]} onChange={(event) => setLimits({ ...limits, [key]: event.currentTarget.valueAsNumber })}
            className="min-w-0 w-full border border-line bg-bg px-3 py-2 text-fg" />
        </label>)}
      </fieldset>
      <button type="submit" disabled={pending} className="mt-4 cursor-pointer border border-line px-4 py-2 disabled:opacity-50">{pending ? strings.saving : strings.save}</button>
      <p role="status" className="mt-2 break-words">{notice}</p>
    </form>
  </details>;
}
