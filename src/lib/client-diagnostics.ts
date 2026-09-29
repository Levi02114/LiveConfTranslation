// Diagnostic labels only: never pass transcript text, device names, URLs or credentials.
export function voiceDiagnostic(phase: string, voiceRun: number, fields: {
  state?: string; mode?: string; durationMs?: number; errorType?: string;
} = {}): void {
  window.dispatchEvent(new CustomEvent("lct-voice-diagnostic", { detail: { phase, voiceRun, ...fields } }));
}

// Only a fixed error category crosses the diagnostics boundary, not message/stack.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export function voiceErrorType(error: unknown): string {
  return error instanceof Error && ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError",
    "InvalidStateError", "AbortError", "NotSupportedError", "TypeError", "RangeError", "NetworkError"].includes(error.name)
    ? error.name : "Error";
}
