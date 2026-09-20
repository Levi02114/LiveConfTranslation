import { requireAdmin } from "@/lib/auth";
import { getSecurityLimits, listMeetings, setSecurityLimits } from "@/lib/repo";
import { securityLimitsSchema } from "@/lib/security-limits";
import { publish } from "@/lib/realtime/hub";
import { providerStatus } from "@/lib/translate/provider-control";
import { wakeTranslationWorker } from "@/lib/translation-worker";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ limits: getSecurityLimits(), providers: providerStatus() });
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = securityLimitsSchema.strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  setSecurityLimits(parsed.data);
  wakeTranslationWorker();
  for (const meeting of listMeetings()) publish(meeting.id, { t: "security-changed" });
  return Response.json({ limits: getSecurityLimits(), providers: providerStatus() });
}
