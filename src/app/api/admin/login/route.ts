import { z } from "zod";

import { createAdminSession, verifyPassword } from "@/lib/auth";

const schema = z.object({ password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "비밀번호를 입력해 주세요" }, { status: 400 });
  }

  if (!verifyPassword(parsed.data.password)) {
    // 어떤 부분이 틀렸는지 알려 주지 않는다. 추측을 돕지 않기 위해서다.
    return Response.json({ error: "비밀번호가 올바르지 않습니다" }, { status: 401 });
  }

  await createAdminSession();
  return Response.json({ ok: true });
}
