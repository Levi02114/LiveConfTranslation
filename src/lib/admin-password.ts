import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { adminPassword, databasePath, sessionSecret } from "@/lib/env";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const HASH_BYTES = 64;
const SALT_BYTES = 16;
const REVISION_BYTES = 24;

type StoredAdminPassword = {
  version: 1;
  salt: string;
  hash: string;
  revision: string;
};

export type ChangeAdminPasswordResult =
  | "ok"
  | "invalid-current"
  | "too-short"
  | "too-long"
  | "same-password";

/** DB와 함께 백업·복구할 수 있는 관리자 비밀번호 해시 파일. */
export function adminPasswordOverridePath(): string {
  return `${databasePath()}.admin-auth.json`;
}

function decode(value: string, bytes?: number): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (!value || (bytes !== undefined && decoded.length !== bytes)) {
    throw new Error("관리자 비밀번호 파일 형식이 올바르지 않습니다.");
  }
  return decoded;
}

function readStored(): StoredAdminPassword | null {
  const file = adminPasswordOverridePath();
  if (!existsSync(file)) return null;

  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredAdminPassword>;
  if (
    parsed.version !== 1 ||
    typeof parsed.salt !== "string" ||
    typeof parsed.hash !== "string" ||
    typeof parsed.revision !== "string"
  ) {
    throw new Error("관리자 비밀번호 파일 형식이 올바르지 않습니다.");
  }

  decode(parsed.salt, SALT_BYTES);
  decode(parsed.hash, HASH_BYTES);
  decode(parsed.revision, REVISION_BYTES);
  return parsed as StoredAdminPassword;
}

function safeEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyAdminPassword(candidate: string): boolean {
  const stored = readStored();
  if (!stored) {
    return safeEquals(Buffer.from(candidate), Buffer.from(adminPassword()));
  }

  const actual = scryptSync(candidate, decode(stored.salt, SALT_BYTES), HASH_BYTES);
  return safeEquals(actual, decode(stored.hash, HASH_BYTES));
}

/** 비밀번호 변경 시에만 달라지는 값. 세션 서명에 넣어 이전 쿠키를 끊는다. */
export function adminCredentialRevision(): string {
  const stored = readStored();
  if (stored) return stored.revision;

  return createHmac("sha256", sessionSecret())
    .update(`bootstrap:${adminPassword()}`)
    .digest("base64url");
}

function writeStored(value: StoredAdminPassword): void {
  const file = adminPasswordOverridePath();
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  mkdirSync(dirname(file), { recursive: true });

  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, file);
    // Windows에서는 mode가 무시되지만 Unix 소스 실행에서는 읽기 권한을 제한한다.
    chmodSync(file, 0o600);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function changeAdminPassword(
  currentPassword: string,
  newPassword: string,
): ChangeAdminPasswordResult {
  if (!verifyAdminPassword(currentPassword)) return "invalid-current";
  if (newPassword.length < MIN_PASSWORD_LENGTH) return "too-short";
  if (newPassword.length > MAX_PASSWORD_LENGTH) return "too-long";
  if (verifyAdminPassword(newPassword)) return "same-password";

  const salt = randomBytes(SALT_BYTES);
  writeStored({
    version: 1,
    salt: salt.toString("base64url"),
    hash: scryptSync(newPassword, salt, HASH_BYTES).toString("base64url"),
    revision: randomBytes(REVISION_BYTES).toString("base64url"),
  });
  return "ok";
}
