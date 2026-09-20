import { requireAdmin } from "@/lib/auth";
import { getVoiceSettings, setVoiceSettings } from "@/lib/repo";
import { notifyAppSettings, voiceSettingsSchema } from "@/lib/voice-settings";

export async function GET() {
  const denied = await requireAdmin();
  return denied ?? Response.json(getVoiceSettings());
}
export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = voiceSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  setVoiceSettings(parsed.data);
  notifyAppSettings();
  return Response.json(getVoiceSettings());
}
