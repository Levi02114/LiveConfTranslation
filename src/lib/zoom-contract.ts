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
  /**
   * speakers: 참가자별 음성 스트림, mixed: 합친 음성(자동 감지), transcript: Zoom 자체 전사,
   * chat: 회의 음성을 받지 않고(RTMS·호스트 승인 없음) 참가자가 고른 입력만 Zoom 채팅으로 보낸다.
   */
  audioMode: z.enum(["speakers", "mixed", "transcript", "chat"]),
  /** 번역문을 Zoom 회의 채팅에도 보낼지. 끄면 세션 기록·조회 화면에만 남는다. */
  chat: z.boolean(),
  consent: z.literal(true),
}).strict();
export const zoomActionSchema = z.discriminatedUnion("action", [
  zoomStartSchema,
  z.object({ action: z.literal("poll"), owner: ownerSchema, ack: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal("stop"), owner: ownerSchema, sdk: z.object({
    // Zoom SDK stopRTMS 결과(진단 기록용). 판정은 클라이언트가 getRTMSStatus까지 확인해 내린다.
    response: z.enum(["success", "failure", "rejected", "timeout", "unbound"]),
    code: z.string().regex(/^\d{1,8}$/).optional(),
    status: z.enum(["stopped", "running", "unknown"]).optional(),
  }).strict().optional() }).strict(),
  z.object({ action: z.literal("assign"), owner: ownerSchema, speaker: z.string().min(1).max(64), lang: z.string().min(2).max(40).nullable() }).strict(),
]);
export type ZoomStart = z.infer<typeof zoomStartSchema>;

export const zoomStatusSchema = z.object({
  session: z.object({ id: z.string().uuid(), title: z.string(), viewerPath: z.string() }),
  state: z.enum(["waiting", "connecting", "live", "paused", "stopped", "error"]),
  error: z.string().nullable(), received: z.number(), sent: z.number(), pending: z.number(),
  next: z.object({ sequence: z.number().int(), text: z.string() }).nullable(),
  speakers: z.array(z.object({ key: z.string(), name: z.string(), lang: z.string().nullable(), active: z.boolean() })),
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

/**
 * 발화 하나를 모든 언어와 함께 한 메시지로 묶는다. 언어마다 따로 보내면 채팅 전송이 발화 속도를
 * 따라가지 못한다. 옛 회의 채팅 한도보다 짧게 자르고 서로게이트 쌍은 쪼개지 않는다.
 */
export function zoomChatChunks(speaker: string, rows: readonly { lang: string; body: string }[]): string[] {
  const prefix = `${speaker.replace(/\p{Cc}/gu, " ").slice(0, 100)}\n`;
  const chars = Array.from(rows.map((row) => `[${row.lang}] ${row.body}`).join("\n"));
  const result: string[] = [];
  let chunk = prefix;
  for (const char of chars) {
    if (chunk.length + char.length > 900) { result.push(chunk); chunk = prefix; }
    chunk += char;
  }
  if (chunk !== prefix) result.push(chunk);
  return result;
}
