import { z } from "zod";

const languageSettingSchema = z.object({
  mode: z.enum(["auto", "manual"]),
  silenceMs: z.number().int().min(300).max(5000).multipleOf(100),
}).strict();
export const voiceSettingsSchema = languageSettingSchema.extend({
  languages: z.record(z.string().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i), languageSettingSchema).optional(),
}).strict();
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { mode: "auto", silenceMs: 1100 };
export function silenceMsFor(settings: VoiceSettings, langs: readonly string[]): number {
  return Math.max(...(langs.length ? langs : ["ko"]).map((lang) => {
    const code = lang.toLowerCase();
    const base = code.split("-")[0];
    const setting = settings.languages?.[lang] ?? settings.languages?.[code] ??
      Object.entries(settings.languages ?? {}).find(([key]) => key.toLowerCase() === code)?.[1] ?? settings.languages?.[base] ?? settings;
    return setting.mode === "manual" ? setting.silenceMs : ["th", "si"].includes(base) ? 1700 : 1100;
  }));
}

declare global {
  var __liveConfSettingsListeners: Set<() => void> | undefined;
  var __liveConfSettingsChanged: (() => void) | undefined;
}
export function notifyAppSettings(): void {
  for (const listener of globalThis.__liveConfSettingsListeners ?? []) listener();
}
export function subscribeAppSettings(listener: () => void): () => void {
  const listeners = globalThis.__liveConfSettingsListeners ??= new Set();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
