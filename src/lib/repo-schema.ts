import { z } from "zod";

import { sessionConfigSchema } from "@/lib/session-config";
import { engineIdSchema } from "@/lib/translate/types";

export const languageCodeSchema = z.string().trim().min(1).max(35);
export const meetingStatusSchema = z.enum(["open", "closed"]);
export const inputModeSchema = z.enum(["human", "realtime"]);
export const transcriptionProviderSchema = z.enum(["openai", "google", "local"]);
export const pageKindSchema = z.enum(["input", "output", "combined", "combined-input", "capture"]);
export const translationStatusSchema = z.enum(["ok", "error"]);
export const storedSecretIdSchema = z.union([
  engineIdSchema,
  z.literal("openai-admin"),
  z.literal("google-speech"),
]);
export type StoredSecretId = z.infer<typeof storedSecretIdSchema>;

export const meetingRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: meetingStatusSchema,
  engine: engineIdSchema,
  fallback_engine: engineIdSchema.nullable(),
  input_mode: inputModeSchema,
  speaker_labels: z.number().int(),
  translation_model: z.string().nullable(),
  transcription_provider: transcriptionProviderSchema,
  transcription_context: z.string().nullable(),
  created_at: z.number(),
  closed_at: z.number().nullable(),
});
export type MeetingRow = z.infer<typeof meetingRowSchema>;

export const pageRowSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  kind: pageKindSchema,
  lang: z.string(),
  token: z.string(),
  created_at: z.number(),
});
export type PageRow = z.infer<typeof pageRowSchema>;

export const languageOnlyRowSchema = z.object({ lang: languageCodeSchema });
export const meetingLanguageConfigRowSchema = z.object({
  lang: languageCodeSchema,
  input_enabled: z.number().int(),
  output_enabled: z.number().int(),
});
export const sessionPresetRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  config_json: z.string().transform((value, context) => {
    try {
      const parsed = sessionConfigSchema.safeParse(JSON.parse(value));
      if (parsed.success) return parsed.data;
    } catch {
      // The issue below covers malformed JSON and invalid session config alike.
    }
    context.addIssue({ code: "custom", message: "올바른 세션 설정 JSON이 아닙니다" });
    return z.NEVER;
  }),
  created_at: z.number(),
  updated_at: z.number(),
});

export const messageRowSchema = z.object({
  id: z.number(),
  meeting_id: z.string(),
  page_id: z.string().nullable(),
  lang: languageCodeSchema,
  body: z.string(),
  speaker_name: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  edited_at: z.number().nullable(),
  created_at: z.number(),
});
export const outputRowSchema = z.object({
  message_id: z.number(),
  body: z.string(),
  speaker_name: z.string().nullable(),
  status: translationStatusSchema,
  error: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  edited_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export const recentTranslationRowSchema = z.object({
  id: z.number(),
  message_id: z.number(),
  lang: languageCodeSchema,
  body: z.string(),
  engine: z.string(),
  status: translationStatusSchema,
  error: z.string().nullable(),
  created_at: z.number(),
  source_lang: languageCodeSchema,
  source_body: z.string(),
  speaker_name: z.string().nullable(),
});
export const messageCountRowSchema = z.object({ c: z.number(), last: z.number().nullable() });
export const translationCountRowSchema = messageCountRowSchema.extend({
  failed: z.number().nullable(),
});
export const logMessageRowSchema = messageRowSchema.pick({
  id: true,
  lang: true,
  body: true,
  speaker_name: true,
  revision: true,
  edited_at: true,
  created_at: true,
});
export const logTranslationRowSchema = z.object({
  message_id: z.number(),
  lang: languageCodeSchema,
  body: z.string(),
  status: translationStatusSchema,
  revision: z.number().int().nonnegative(),
  edited_at: z.number().nullable(),
  created_at: z.number(),
});
export const bodyRowSchema = z.object({ body: z.string() });
export const combinedTranslationRowSchema = z.object({
  message_id: z.number(),
  lang: languageCodeSchema,
  body: z.string(),
  status: translationStatusSchema,
  error: z.string().nullable(),
  created_at: z.number(),
});

export const engineSecretRowSchema = z.object({
  engine: storedSecretIdSchema,
  secret: z.instanceof(Uint8Array),
  hint: z.string(),
  updated_at: z.number(),
});
export const engineSecretInfoRowSchema = engineSecretRowSchema.omit({ secret: true });
export const languageRowSchema = z.object({
  code: languageCodeSchema,
  position: z.number(),
  added_at: z.number(),
});
export const maxPositionRowSchema = z.object({ max: z.number().nullable() });
export const uiStringRowSchema = z.object({
  key: z.string(),
  text: z.string(),
  origin: z.enum(["machine", "manual"]),
});
export const glossaryEntryRowSchema = z.object({
  id: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
});
export const glossaryTermRowSchema = z.object({
  entry_id: z.string(),
  lang: languageCodeSchema,
  term: z.string(),
});
export const glossaryPairRowSchema = z.object({ source: z.string(), target: z.string() });
export const promptCueRowSchema = z.object({
  text: z.string(),
  engine: engineIdSchema,
  updated_at: z.number(),
});
export const engineSettingRowSchema = z.object({
  engine: engineIdSchema,
  model: z.string().nullable(),
  updated_at: z.number(),
});
export const transcriptionSettingRowSchema = z.object({
  model: transcriptionProviderSchema,
});
export const openaiModelRowSchema = z.object({ model: z.string() });
