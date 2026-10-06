"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { AdminStrings } from "@/lib/i18n-builtin";
import { parseJsonResponse } from "@/lib/json-response";

/** 세션 생성 화면은 현재 기본값을 표시하고, API 설정에서는 목록에서 선택한다. */
export function OpenaiModelSelect({
  label,
  model,
  hidden,
  models,
  disabled,
  onChange,
}: {
  label: string;
  model: string;
  hidden: boolean;
  models?: string[];
  disabled?: boolean;
  onChange?: (model: string) => void;
}) {
  if (hidden) return null;

  return (
    <>
      <span className="font-mono text-[11px] text-muted">{label}</span>
      {onChange ? <select aria-label={label} value={model} disabled={disabled}
        onChange={(event) => onChange(event.target.value)} className="min-w-0 max-w-full border border-line bg-bg px-2.5 py-1.5 text-sm">
        {[...new Set([model, ...(models ?? [])])].map((value) => <option key={value} value={value}>{value}</option>)}
      </select> : <output className="max-w-full border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px]">
        {model}
      </output>}
    </>
  );
}

const catalogSchema = z.object({
  models: z.array(z.string()), model: z.string(),
  source: z.enum(["live", "cache", "no-key", "error"]),
});
const savedModelSchema = z.object({ engine: z.literal("openai"), model: z.string() });

export function OpenaiModelSettings({ strings, configured, keyUpdatedAt, disabled }: {
  strings: AdminStrings["keys"]; configured: boolean; keyUpdatedAt: number | null; disabled: boolean;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<z.infer<typeof catalogSchema> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (cached = false) => {
      const started = revision.current;
      try {
        const response = await fetch(`/api/admin/openai-models${cached ? "?cache=1" : ""}`, {
          cache: "no-store", signal: abort.signal,
        });
        const payload = await parseJsonResponse(response, catalogSchema);
        if (!response.ok || !payload) throw new Error();
        if (abort.signal.aborted) return;
        setLoadFailed(false);
        setCatalog((previous) => {
          const model = (savingRef.current || started !== revision.current) && previous ? previous.model : payload.model;
          const sameModels = previous && previous.models.length === payload.models.length &&
            previous.models.every((value, index) => value === payload.models[index]);
          if (sameModels && previous.model === model && previous.source === payload.source) return previous;
          return { ...payload, model, models: sameModels ? previous.models : payload.models };
        });
      } catch {
        if (!abort.signal.aborted) setLoadFailed(true);
      } finally {
        // 완료 후 예약하여 느린 네트워크에서도 목록 요청이 겹치지 않는다.
        if (!cached && !abort.signal.aborted) timer = setTimeout(() => void load(), 60_000);
      }
    };
    void (async () => { await load(true); if (!abort.signal.aborted) await load(); })();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [configured, keyUpdatedAt]);

  const save = async (model: string) => {
    if (savingRef.current || disabled || !configured) return;
    savingRef.current = true;
    revision.current++;
    setSaving(true);
    setSaveFailed(false);
    try {
      const response = await fetch("/api/admin/engine-settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ engine: "openai", model }),
      });
      const payload = await parseJsonResponse(response, savedModelSchema);
      if (!response.ok || !payload) throw new Error();
      setCatalog((previous) => previous ? { ...previous, model: payload.model } : previous);
      revision.current++;
      router.refresh();
    } catch { setSaveFailed(true); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return <div className="mt-4 grid min-w-0 gap-2 text-sm">
    {catalog ? <OpenaiModelSelect label={strings.model} model={catalog.model} models={catalog.models}
      hidden={false} disabled={disabled || saving || !configured} onChange={(model) => void save(model)} /> : null}
    <p>{strings.modelHelp}</p>
    <p>{strings.modelPolling}</p>
    <p role="status">{saving ? strings.saving : !catalog && !loadFailed ? strings.modelsLoading :
      !configured || catalog?.source === "no-key" ? strings.modelsNoKey :
      loadFailed || catalog?.source === "error" ? strings.modelsFailed : catalog?.source === "cache" ? strings.modelsCached : ""}</p>
    {saveFailed ? <p role="alert">{strings.modelSaveFailed}</p> : null}
  </div>;
}
