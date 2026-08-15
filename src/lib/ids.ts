import { randomBytes, randomUUID } from "node:crypto";

/** 회의·페이지의 내부 식별자 */
export function newId(): string {
  return randomUUID();
}

/**
 * URL 에 들어가는 페이지 토큰.
 *
 * 이 토큰이 곧 접근 권한이다(로그인이 없다). 추측으로 뚫리지 않게 128비트를 쓰고,
 * 손으로 옮겨 적거나 구두로 불러 줄 일이 있으므로 대소문자 혼동이 없는
 * base32 계열 문자만 쓴다.
 */
const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newPageToken(length = 26): string {
  const bytes = randomBytes(length);
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return token;
}
