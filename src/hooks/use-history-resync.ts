"use client";

import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";
import { z } from "zod";

import { mergeCombinedEntries } from "@/lib/combined-entry";
import { parseJsonResponse } from "@/lib/json-response";
import type { CombinedEntry } from "@/lib/repo";

const sinceResponseSchema = z.object({
  snapshotAt: z.number(),
  entries: z.array(z.object({
    messageId: z.number(),
    sourceLang: z.string(),
    sourceBody: z.string(),
    speakerName: z.string().nullable(),
    pageId: z.string().nullable(),
    revision: z.number(),
    editedAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
    translations: z.array(z.object({
      lang: z.string(),
      body: z.string(),
      status: z.enum(["ok", "error"]),
      error: z.string().nullable(),
    })),
  })),
});

/**
 * WebSocket이 (다시) 열릴 때마다 끊겨 있던 동안의 원문·번역을 받아 합친다.
 * 페이지 렌더와 첫 연결 사이에 온 메시지도 같은 경로로 채운다.
 */
export function useHistoryResync(
  token: string,
  history: CombinedEntry[],
  setEntries: Dispatch<SetStateAction<CombinedEntry[]>>,
) {
  const [initial] = useState(() => history.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0));
  const watermark = useRef(initial);
  return useCallback(async () => {
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(token)}?since=${watermark.current}`, { cache: "no-store" });
      const payload = await parseJsonResponse(response, sinceResponseSchema);
      if (!response.ok || !payload) return;
      if (payload.entries.length) setEntries((current) => mergeCombinedEntries(current, payload.entries));
      watermark.current = payload.snapshotAt;
    } catch {
      // 다음 재연결에서 같은 기준 시각으로 다시 받는다.
    }
  }, [setEntries, token]);
}
