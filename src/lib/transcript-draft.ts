export function appendTranscriptDraft(current: string, transcript: string): string {
  const prefix = current.trimEnd();
  const next = transcript.trim();
  return prefix ? `${prefix} ${next}` : next;
}
