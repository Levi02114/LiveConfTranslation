import { z } from "zod";
import { engineIdSchema } from "./translate/types";

export const zoomCredentialsSchema = z.object({
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().trim().max(2048),
  webhookSecret: z.string().trim().max(2048),
}).strict();

const ownerSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const zoomStartSchema = z.object({
  action: z.literal("start"),
  owner: ownerSchema,
  zoomMeeting: z.string().min(1).max(256),
  zoomTitle: z.string().trim().min(1).max(200),
  engine: engineIdSchema,
  fallbackEngine: engineIdSchema.nullable(),
  sourceLang: z.string().min(2).max(40),
  targets: z.array(z.string().min(2).max(40)).min(1).max(20),
  consent: z.literal(true),
}).strict();
export const zoomActionSchema = z.discriminatedUnion("action", [
  zoomStartSchema,
  z.object({ action: z.literal("poll"), owner: ownerSchema, ack: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal("stop"), owner: ownerSchema }).strict(),
]);
export type ZoomStart = z.infer<typeof zoomStartSchema>;

export const zoomStatusSchema = z.object({
  session: z.object({ id: z.string().uuid(), title: z.string(), viewerPath: z.string() }),
  state: z.enum(["waiting", "connecting", "live", "paused", "stopped", "error"]),
  error: z.string().nullable(), received: z.number(), sent: z.number(), pending: z.number(),
  next: z.object({ sequence: z.number().int(), text: z.string() }).nullable(),
});
export type ZoomStatus = z.infer<typeof zoomStatusSchema>;
export const zoomSettingsSchema = z.object({
  clientId: z.string(), hasClientSecret: z.boolean(), hasWebhookSecret: z.boolean(),
  configured: z.boolean(), active: z.boolean(), writable: z.boolean(),
  homeUrl: z.string().url(), webhookUrl: z.string().url(),
  existingSession: z.object({ id: z.string().uuid(), title: z.string(), closed: z.boolean(),
    engine: engineIdSchema, fallbackEngine: engineIdSchema.nullable(), model: z.string().nullable(),
    targets: z.array(z.string()), viewerPath: z.string() }).nullable(),
});

/** Zoom RTMS language IDs, not array positions in our configurable language list. */
export const ZOOM_LANGUAGES = ["ar", "bn", "yue", "ca", "zh-CN", "zh-TW", "cs", "da", "nl", "en", "et", "fi", "fr-CA", "fr", "de", "he", "hi", "hu", "id", "it", "ja", "ko", "ms", "fa", "pl", "pt", "ro", "ru", "es", "sv", "fil", "ta", "te", "th", "tr", "uk", "vi"] as const;

export function zoomLanguageId(code: string): number {
  const exact = ZOOM_LANGUAGES.findIndex((lang) => lang.toLowerCase() === code.toLowerCase());
  return exact >= 0 ? exact : ZOOM_LANGUAGES.findIndex((lang) => lang === code.split("-")[0]);
}

/** Stay below legacy meeting-chat limits without splitting surrogate pairs. */
export function zoomChatChunks(speaker: string, lang: string, text: string): string[] {
  const prefix = `[${lang}] ${speaker.replace(/\p{Cc}/gu, " ").slice(0, 100)}\n`;
  const chars = Array.from(text);
  const result: string[] = [];
  let chunk = prefix;
  for (const char of chars) {
    if (chunk.length + char.length > 900) { result.push(chunk); chunk = prefix; }
    chunk += char;
  }
  if (chunk !== prefix) result.push(chunk);
  return result;
}
