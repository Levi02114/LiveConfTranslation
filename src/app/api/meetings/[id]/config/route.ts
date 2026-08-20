import { requireAdmin } from "@/lib/auth";

/** 세션 설정은 생성 시 확정되며 이후에는 변경할 수 없다. */
export async function PUT() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ error: "immutable" }, { status: 409 });
}
