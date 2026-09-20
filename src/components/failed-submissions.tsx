"use client";

import { useEffect, useState } from "react";
import type { UiStrings } from "@/lib/i18n-builtin";

export type FailedSubmission = { id: string; body: string; retryAt: number; retry: () => void };

export function FailedSubmissions({ entries, strings, disabled }: { entries: FailedSubmission[]; strings: UiStrings["input"]; disabled: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!entries.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entries.length]);
  if (!entries.length) return null;
  return <aside className="my-2 max-h-48 overflow-y-auto border border-line p-3">
    <p className="mb-2 break-words">{strings.retained}</p>
    {entries.map((entry) => <div key={entry.id} className="my-2 flex min-w-0 flex-wrap items-start gap-2">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.body}</p>
      <button type="button" disabled={disabled || entry.retryAt > now} onClick={entry.retry}
        className="cursor-pointer border border-line px-3 py-2 disabled:opacity-40">{strings.retry}</button>
    </div>)}
  </aside>;
}
