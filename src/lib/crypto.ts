/*
 * `env.ts` 와 같은 이유로 `server-only` 를 걸지 않는다 — 커스텀 서버가
 * 번들러를 거치지 않고 불러올 수 있어야 한다. node: 내장 모듈에 의존하므로
 * 클라이언트 번들에 섞이면 빌드 단계에서 바로 실패한다.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { sessionSecret } from "@/lib/env";

/**
 * DB 에 넣는 비밀값(번역 엔진 API 키)의 암·복호화.
 *
 * `node:sqlite` 에는 SQLCipher 같은 파일 단위 암호화가 없다. 그래서 파일이 아니라
 * **값을 암호화해서** 넣는다. DB 파일을 그대로 복사해 가도 키는 읽히지 않는다.
 *
 * AES-256-GCM 을 쓰는 이유는 기밀성과 무결성을 함께 얻기 위해서다. 누가 DB 를
 * 열어 암호문을 바꿔치기하면 복호화가 실패한다(조용히 다른 값이 나오지 않는다).
 *
 * ⚠️ 이 암호화가 막아 주는 것은 **저장된 파일을 손에 넣은 사람**이다.
 *    서버 프로세스를 장악한 사람은 어차피 `SESSION_SECRET` 도 읽을 수 있다.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 표준 권장값
const TAG_BYTES = 16;

/**
 * 쿠키 서명 키를 그대로 암호화에 쓰지 않는다.
 *
 * 한 키를 두 용도로 쓰면 한쪽의 약점이 다른 쪽으로 번진다. HKDF 로 용도 라벨을
 * 섞어 서로 무관한 키를 뽑는다. 라벨을 바꾸면 기존 암호문은 못 읽으므로 고정한다.
 */
function derivedKey(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", sessionSecret(), "lct.secret.salt.v1", "lct.engine-secret.v1", 32),
  );
}

/** 평문 → `iv || authTag || 암호문` */
export function encryptSecret(plain: string): Uint8Array {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Uint8Array.from(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

/**
 * 복호화. 실패하면 던지지 않고 `null` 을 준다.
 *
 * `SESSION_SECRET` 을 교체하면 기존 암호문을 읽을 수 없게 되는데, 그 때문에
 * 관리자 화면 전체가 500 으로 죽으면 안 된다. 호출부가 "다시 등록해 주세요" 로
 * 처리할 수 있도록 값 없음으로 떨어뜨린다.
 */
export function decryptSecret(blob: Uint8Array): string | null {
  if (blob.length <= IV_BYTES + TAG_BYTES) return null;

  try {
    const buffer = Buffer.from(blob);
    const decipher = createDecipheriv(
      ALGORITHM,
      derivedKey(),
      buffer.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

    return Buffer.concat([
      decipher.update(buffer.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // 인증 태그 불일치(변조) 또는 키 불일치.
    return null;
  }
}

/**
 * 화면에 보여 줄 마스킹 문자열.
 *
 * 관리자가 "어떤 키를 넣어 뒀는지" 구분할 수 있어야 하지만, 키 자체가 화면으로
 * 돌아가서는 안 된다. 앞뒤 몇 글자만 남긴다. 짧은 값은 아예 가린다.
 */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "•".repeat(Math.max(plain.length, 4));
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}

/** 같은 키를 다시 저장한 것인지 비교. 길이까지 숨길 필요는 없어 단순 비교로 둔다. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
