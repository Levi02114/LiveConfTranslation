import { z } from "zod";

import { changeAdminPassword } from "@/lib/admin-password";
import { createAdminSession, isAdmin } from "@/lib/auth";
import { disconnectAdminConnections } from "@/lib/realtime/hub";

const schema = z.object({
  currentPassword: z.string().min(1).max(4096),
  newPassword: z.string().min(1).max(4096),
});

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: "auth-required" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid-request" }, { status: 400 });
  }

  try {
    const result = changeAdminPassword(
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (result !== "ok") {
      return Response.json({ error: result }, { status: 400 });
    }

    // 새 revision으로 현재 브라우저의 쿠키를 다시 만들고 나머지 관리자 소켓을 끊는다.
    await createAdminSession();
    disconnectAdminConnections();
    return Response.json({ ok: true });
  } catch (error) {
    console.error(
      "[auth] 관리자 비밀번호를 변경하지 못했습니다:",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
