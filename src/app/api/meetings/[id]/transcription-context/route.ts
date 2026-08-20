import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { updateTranscriptionContext } from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  context: z.string().trim().max(300).nullable(),
});

export async function PUT(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });

  const { id } = await params;
  const result = updateTranscriptionContext(id, parsed.data.context);
  if (!result.ok) return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  return Response.json({ ok: true });
}
