"use client";

import type { AdminStrings } from "@/lib/i18n-builtin";
import { getLanguage } from "@/lib/languages";
import type { SessionConnections } from "@/lib/realtime/protocol";

export function ConnectionCountsView({ counts, live, strings, lang }: {
  counts?: SessionConnections;
  live: boolean;
  strings: AdminStrings["operations"];
  lang: string;
}) {
  return <div className="min-w-0 space-y-1 font-mono text-[0.75rem] leading-relaxed" data-connection-counts={counts?.meetingId}>
    <p>{strings.connections}: <strong>{counts?.total ?? "—"}</strong> · <span className="text-muted">{live ? strings.liveCounts : strings.staleCounts}</span></p>
    {counts ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
      {counts.languages.map((row) => <span key={row.lang}>{getLanguage(row.lang, lang).label}: {strings.inputCount} {row.input} / {strings.outputCount} {row.output}</span>)}
      <span>{strings.combinedInputCount} {counts.combinedInput}</span>
      <span>{strings.combinedCount} {counts.combined}</span>
      <span>{strings.captureCount} {counts.capture}</span>
    </div> : null}
  </div>;
}
