import "server-only";

import { log } from "@/lib/diagnostics";
import { resolveEntries } from "@/lib/i18n";
import { getLastEngineSetting, listLanguages } from "@/lib/repo";
import { listEngines } from "@/lib/translate";
import type { EngineId } from "@/lib/translate/types";
import { translateUiStrings } from "@/lib/ui-translate";

const START_DELAY_MS = 30_000;

declare global { var __liveConfUiAutofill: boolean | undefined; }

/** 마지막으로 쓴 엔진을 우선한다. 로컬 엔진은 자동으로 띄우지 않는다. */
function engineFor(lang: string): EngineId | null {
  const engines = listEngines().filter((engine) => engine.id !== "local" && engine.isConfigured() && engine.supports(lang));
  const last = getLastEngineSetting()?.engine;
  return (engines.find((engine) => engine.id === last) ?? engines[0])?.id ?? null;
}

/**
 * 앱 업데이트로 새 문구가 생기면 관리자가 추가한 언어에는 번역이 없어 한국어 원문이 보인다.
 * 서버가 뜬 뒤 한 번, 빠진 문구만 기계 번역해 채운다. 손으로 고친 문구는 건드리지 않는다.
 */
export async function fillMissingUiStrings() {
  for (const { code } of listLanguages()) {
    if (code === "ko") continue;
    const missing = resolveEntries(code).filter((entry) => entry.origin === "fallback").length;
    if (!missing) continue;
    const engine = engineFor(code);
    if (!engine) { log("info", "ui.strings-autofill", { to: code, count: missing, reason: "noEngine" }); continue; }
    const result = await translateUiStrings(code, engine, { missingOnly: true, keepManual: true }).catch(() => ({ translated: 0, failed: missing }));
    log(result.failed ? "warn" : "info", "ui.strings-autofill", { to: code, provider: engine, count: result.translated, dropped: result.failed });
  }
}

export function scheduleUiStringAutofill() {
  if (globalThis.__liveConfUiAutofill) return;
  globalThis.__liveConfUiAutofill = true;
  // 시작 직후의 첫 창 표시·서버 응답을 늦추지 않게 잠시 뒤에 돈다.
  setTimeout(() => void fillMissingUiStrings().catch(() => {}), START_DELAY_MS).unref?.();
}
