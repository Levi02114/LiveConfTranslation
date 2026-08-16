/*
 * 관리자 세션의 Next 연동 부분.
 *
 * `next/headers` 를 쓰므로 **Next 요청 컨텍스트 안에서만** 불러야 한다.
 * 커스텀 서버가 필요로 하는 검증 로직은 `auth-core.ts` 에 있다.
 */

import { cookies, headers } from "next/headers";

import { SESSION_COOKIE, signExpiry, verifySessionValue } from "@/lib/auth-core";
import { sessionTtlSeconds } from "@/lib/env";

export { verifyPassword } from "@/lib/auth-core";

/** 로그인 성공 시 세션 쿠키를 심는다. */
export async function createAdminSession(): Promise<void> {
  const ttl = sessionTtlSeconds();
  const expiresAt = Date.now() + ttl * 1000;

  const store = await cookies();
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  store.set(SESSION_COOKIE, `${expiresAt}.${signExpiry(expiresAt)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ttl,
    secure,
  });
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** 현재 요청이 로그인된 관리자인지 */
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifySessionValue(store.get(SESSION_COOKIE)?.value);
}

/** API 라우트용 가드. 관리자가 아니면 401 응답을, 맞으면 null 을 돌려준다. */
export async function requireAdmin(): Promise<Response | null> {
  if (await isAdmin()) return null;
  return Response.json({ error: "관리자 인증이 필요합니다" }, { status: 401 });
}
