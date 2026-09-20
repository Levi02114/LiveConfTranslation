"use client";

import { useState } from "react";
import { z } from "zod";
import { useRealtime } from "@/hooks/use-realtime";
import type { AdminStrings } from "@/lib/i18n-builtin";

const snapshotSchema = z.object({
  counts: z.object({ pending: z.number(), running: z.number(), failed: z.number() }),
  providers: z.record(z.string(), z.object({ active: z.number(), blockedUntil: z.number() })),
});

export function TranslationJobs({ meetingId, strings }: { meetingId: string; strings: AdminStrings["security"] }) {
  const [snapshot, setSnapshot] = useState<z.infer<typeof snapshotSchema>>({ counts: { pending: 0, running: 0, failed: 0 }, providers: {} });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/meetings/${encodeURIComponent(meetingId)}/translation-jobs`;
  const refresh = async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = snapshotSchema.safeParse(await response.json());
      if (response.ok && payload.success) setSnapshot(payload.data);
    } catch { setError(strings.failed); }
  };
  useRealtime(`meeting=${encodeURIComponent(meetingId)}`, (message) => {
    if (message.t === "translation-jobs") setSnapshot({ counts: message.counts, providers: message.providers ?? {} });
    if (message.t === "hello" || message.t === "security-changed") void refresh();
  });
  const act = async (action: "retry" | "cancel") => {
    if (pending || (action === "cancel" && !window.confirm(strings.confirmCancel))) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) { setError(response.status === 429 ? strings.limitReached : strings.failed); return; }
      const payload = snapshotSchema.safeParse(await response.json());
      if (payload.success) setSnapshot(payload.data);
    } catch { setError(strings.failed); }
    finally { setPending(false); }
  };
  return <section className="my-5 min-w-0 border-y border-line py-4">
    <h2 className="break-words">{strings.jobs}</h2>
    <dl className="my-3 flex flex-wrap gap-x-6 gap-y-2" aria-live="polite">
      {(["pending", "running", "failed"] as const).map((key) => <div key={key} className="flex min-w-0 flex-wrap gap-2">
        <dt>{key === "failed" ? strings.failedJobs : strings[key]}</dt><dd>{snapshot.counts[key]}</dd>
      </div>)}
    </dl>
    <div className="flex flex-wrap gap-3">
      <button disabled={pending} onClick={() => void act("retry")} className="cursor-pointer border border-line px-3 py-2 disabled:opacity-40">{strings.retry}</button>
      <button disabled={pending || !snapshot.counts.pending} onClick={() => void act("cancel")} className="cursor-pointer border border-line px-3 py-2 disabled:opacity-40">{strings.cancel}</button>
    </div>
    <h3 className="mt-4">{strings.providers}</h3>
    <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
      {Object.entries(snapshot.providers).map(([name, provider]) => <li key={name} className="break-words">
        {name} · {strings.active}: {provider.active}{provider.blockedUntil > 0 ? ` · ${strings.paused}` : ""}
      </li>)}
    </ul>
    <p role="alert" className="mt-2 break-words">{error}</p>
  </section>;
}
