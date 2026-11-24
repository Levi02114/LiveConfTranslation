import { createHmac, timingSafeEqual } from "node:crypto";

import { sessionSecret } from "@/lib/env";

/*
 * 입력자 안내 주소의 토큰.
 *
 * 안내 화면은 입력 페이지 링크를 모두 보여 주므로, 참가자에게 공개되는 통합 조회
 * 토큰만으로 열리면 안 된다. 통합 조회 토큰에 서버 비밀값 서명을 붙여 따로 만든다.
 */
function sign(combinedToken: string): string {
  return createHmac("sha256", sessionSecret())
    .update(`input-guide:${combinedToken}`)
    .digest("base64url")
    .slice(0, 22);
}

export function inputGuideToken(combinedToken: string): string {
  return `${combinedToken}.${sign(combinedToken)}`;
}

/** 서명이 맞으면 통합 조회 토큰을, 아니면 null을 돌려준다. */
export function combinedTokenFromInputGuide(value: string): string | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const token = value.slice(0, separator);
  const actual = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(sign(token));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? token : null;
}
