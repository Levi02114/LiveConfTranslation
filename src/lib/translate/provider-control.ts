import { getSecurityLimits } from "@/lib/repo";
import { TranslationError, isTransientTranslationError, type EngineId } from "./types";

type ProviderState = { active: number; failures: number; blockedUntil: number; probe: boolean };
declare global { var __translationProviders: Map<EngineId, ProviderState> | undefined; }
function states() { return globalThis.__translationProviders ??= new Map<EngineId, ProviderState>(); }
export function providerStatus() { return Object.fromEntries(states()); }

export async function callProvider<T>(engine: EngineId, signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const state = states().get(engine) ?? { active: 0, failures: 0, blockedUntil: 0, probe: false };
  states().set(engine, state);
  const limits = getSecurityLimits();
  if (state.blockedUntil > Date.now() || state.probe) {
    throw new TranslationError("provider-paused", engine, undefined, "provider-paused", Math.max(1000, state.blockedUntil - Date.now()));
  }
  if (state.active >= (engine === "local" ? limits.translationLocal : limits.translationOnline)) {
    throw new TranslationError("provider-busy", engine, undefined, "provider-busy", 1000);
  }
  const probe = state.blockedUntil > 0;
  state.probe = probe;
  state.active++;
  try {
    const bounded = AbortSignal.any([AbortSignal.timeout(engine === "local" ? 120000 : 30000), ...(signal ? [signal] : [])]);
    bounded.throwIfAborted();
    const result = await run(bounded);
    bounded.throwIfAborted();
    state.failures = 0;
    state.blockedUntil = 0;
    return result;
  } catch (error) {
    if (!signal?.aborted && isTransientTranslationError(error)) {
      state.failures++;
      if (state.failures >= 5 || probe) state.blockedUntil = Date.now() + 30000;
    }
    throw error;
  } finally {
    state.active--;
    if (probe) state.probe = false;
  }
}
