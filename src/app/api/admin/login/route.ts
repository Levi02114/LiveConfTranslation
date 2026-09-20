import { z } from "zod";

import { createAdminSession, verifyPassword } from "@/lib/auth";
import { PasswordBusyError } from "@/lib/admin-password";
import { beginLoginAttempt } from "@/lib/security-limits";

const schema = z.object({ password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "비밀번호를 입력해 주세요" }, { status: 400 });
  }
  const attempt = beginLoginAttempt(request.headers.get("x-lct-ip") ?? "unknown");
  if (attempt.retryAfter) return Response.json({ error: "rate-limited" }, { status: 429, headers: { "Retry-After": String(attempt.retryAfter) } });

  let valid = false;
  try {
    valid = await verifyPassword(parsed.data.password);
  } catch (error) {
    if (error instanceof PasswordBusyError) {
      attempt.finish("busy");
      return Response.json({ error: "rate-limited" }, { status: 429, headers: { "Retry-After": "1" } });
    }
    attempt.finish("failure");
    return Response.json({ error: "auth-failed" }, { status: 401 });
  }
  attempt.finish(valid ? "success" : "failure");
  if (!valid) {
    // 어떤 부분이 틀렸는지 알려 주지 않는다. 추측을 돕지 않기 위해서다.
    return Response.json({ error: "비밀번호가 올바르지 않습니다" }, { status: 401 });
  }

  await createAdminSession();
  return Response.json({ ok: true });
}
