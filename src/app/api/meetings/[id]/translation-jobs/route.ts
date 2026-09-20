import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getMeeting, getTranslationJobCounts, inputErrorResponse, manageTranslationJobs } from "@/lib/repo";
import { providerStatus } from "@/lib/translate/provider-control";
import { publish } from "@/lib/realtime/hub";
import { publishJobCounts, wakeTranslationWorker } from "@/lib/translation-worker";

type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await params;
  if (!getMeeting(id)) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ counts: getTranslationJobCounts(id), providers: providerStatus() });
}
export async function POST(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await params;
  if (!getMeeting(id)) return Response.json({ error: "not-found" }, { status: 404 });
  const parsed = z.object({ action: z.enum(["retry", "cancel"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  try {
    const cancelled = manageTranslationJobs(id, parsed.data.action);
    for (const { message, lang, engine, createdAt } of cancelled) publish(id, {
      t: "translation", messageId: message.id, sourceLang: message.lang, lang, body: "", engine,
      speakerName: message.speakerName, status: "error", error: "translation-cancelled",
      revision: message.revision, editedAt: message.editedAt, sourceCreatedAt: message.createdAt, createdAt,
    });
    publishJobCounts(id);
    wakeTranslationWorker();
    return Response.json({ counts: getTranslationJobCounts(id), providers: providerStatus() });
  } catch (error) {
    const response = inputErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
