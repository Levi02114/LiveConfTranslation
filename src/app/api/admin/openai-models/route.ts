import { requireAdmin } from "@/lib/auth";
import { resolveOpenaiModel } from "@/lib/secrets";

/** 호환 경로. OpenAI 번역 모델은 하나로 고정되어 목록 조회를 하지 않는다. */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  return Response.json({ models: [resolveOpenaiModel()], source: "fixed" as const });
}
