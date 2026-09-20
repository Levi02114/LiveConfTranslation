type ActiveTranscription = {
  meetingId: string;
  pageId: string;
  clientId: string;
  signal: AbortSignal;
  stop: () => void;
};
declare global { var __activeTranscriptions: Map<string, ActiveTranscription> | undefined; }
export function activeTranscriptions(): Map<string, ActiveTranscription> {
  return globalThis.__activeTranscriptions ??= new Map();
}
export function stopTranscription(leaseId: string): void {
  const active = activeTranscriptions().get(leaseId);
  activeTranscriptions().delete(leaseId);
  active?.stop();
}
export function transcriptionSignal(leaseId: string): AbortSignal | undefined {
  return activeTranscriptions().get(leaseId)?.signal;
}
