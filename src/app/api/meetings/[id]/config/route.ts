import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { disconnectDisabledPages } from "@/lib/realtime/hub";
import { releaseMeetingCaptures } from "@/lib/realtime/capture-lease";
import { hasLanguage, updateMeetingConfig } from "@/lib/repo";
import { sessionConfigSchema } from "@/lib/session-config";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = sessionConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.languages.some((row) => !hasLanguage(row.lang))) {
    return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });
  }

  const { id } = await params;
  const result = updateMeetingConfig(
    id,
    parsed.data.languages.map((row) => ({ ...row, lang: row.lang })),
    parsed.data.speakerLabels,
    parsed.data.combinedInputFallbackLang,
  );
  if (!result.ok) {
    const status = result.reason === "not-found" ? 404 : 409;
    return Response.json({ error: result.reason }, { status });
  }

  disconnectDisabledPages(id, parsed.data.languages, parsed.data.combinedInputFallbackLang);
  releaseMeetingCaptures(id);

  revalidatePath("/admin");
  revalidatePath(`/admin/meetings/${id}`);
  return Response.json({ meeting: result.meeting });
}
