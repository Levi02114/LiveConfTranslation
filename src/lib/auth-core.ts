/*
 * 관리자 인증의 순수 부분 — 서명, 검증, 원시 쿠키 헤더 해석.
 *
 * `next/headers` 를 쓰지 않는다. 커스텀 서버(`server.ts`)가 WebSocket 업그레이드를
 * 인증할 때 이 모듈을 부르는데, Next 의 쿠키 API 는 Next 요청 컨텍스트 밖에서
 * 로드되기만 해도 던지기 때문이다.
 *
 * Next 요청 컨텍스트가 필요한 부분은 `auth.ts` 에 있다.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { adminPassword, sessionSecret } from "@/lib/env";

export const SESSION_COOKIE = "lct_admin";

export function signExpiry(expiresAt: number): string {
  return createHmac("sha256", sessionSecret())
    .update(String(expiresAt))
    .digest("base64url");
}

/** 길이가 달라도 안전하게 비교한다. `timingSafeEqual` 은 길이가 다르면 던진다. */
function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function verifyPassword(candidate: string): boolean {
  return safeEquals(candidate, adminPassword());
}

/** 쿠키 값 하나가 유효한 관리자 세션인지. 서명과 만료를 함께 본다. */
export function verifySessionValue(raw: string | undefined): boolean {
  if (!raw) return false;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return false;

  const expiresAt = Number(raw.slice(0, separator));
  const signature = raw.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  return safeEquals(signature, signExpiry(expiresAt));
}

/**
 * WebSocket 업그레이드 요청의 관리자 인증.
 *
 * 업그레이드는 Next 라우트 밖에서 처리되므로 원시 Cookie 헤더에서 직접 뽑는다.
 */
export function isAdminFromCookieHeader(header: string | undefined): boolean {
  if (!header) return false;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    return verifySessionValue(decodeURIComponent(part.slice(separator + 1).trim()));
  }

  return false;
}
