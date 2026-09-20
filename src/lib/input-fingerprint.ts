import { createHash } from "node:crypto";

/** Keep the original request identity independent of detection, rewriting and edits. */
export function inputFingerprint(lang: string | null, body: string, speaker?: string | null): string {
  return createHash("sha256").update(JSON.stringify([lang, body.trim(), speaker?.trim() || null])).digest("hex");
}
