import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  adminCredentialRevision,
  adminPasswordOverridePath,
  changeAdminPassword,
  verifyAdminPassword,
} from "./admin-password";
import { signExpiry, verifySessionValue } from "./auth-core";

test("변경한 관리자 비밀번호는 저장되고 이전 세션은 무효화된다", () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-admin-password-"));
  const previous = {
    admin: process.env.ADMIN_PASSWORD,
    database: process.env.DATABASE_PATH,
    secret: process.env.SESSION_SECRET,
  };

  process.env.ADMIN_PASSWORD = "initial-password";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.DATABASE_PATH = join(directory, "meetings.db");

  try {
    const expiresAt = Date.now() + 60_000;
    const oldSession = `${expiresAt}.${signExpiry(expiresAt)}`;
    const oldRevision = adminCredentialRevision();

    assert.equal(verifyAdminPassword("initial-password"), true);
    assert.equal(changeAdminPassword("wrong-password", "new-password-123"), "invalid-current");
    assert.equal(changeAdminPassword("initial-password", "short"), "too-short");
    assert.equal(changeAdminPassword("initial-password", "initial-password"), "same-password");
    assert.equal(changeAdminPassword("initial-password", "new-password-123"), "ok");
    assert.equal(verifyAdminPassword("initial-password"), false);
    assert.equal(verifyAdminPassword("new-password-123"), true);
    assert.notEqual(adminCredentialRevision(), oldRevision);
    assert.equal(verifySessionValue(oldSession), false);

    unlinkSync(adminPasswordOverridePath());
    assert.equal(verifyAdminPassword("initial-password"), true);
  } finally {
    if (previous.admin === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous.admin;
    if (previous.database === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous.database;
    if (previous.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous.secret;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("손상된 비밀번호 파일은 초기 비밀번호로 폴백하지 않는다", () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-admin-password-corrupt-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousAdmin = process.env.ADMIN_PASSWORD;
  process.env.DATABASE_PATH = join(directory, "meetings.db");
  process.env.ADMIN_PASSWORD = "initial-password";

  try {
    writeFileSync(adminPasswordOverridePath(), "{}\n");
    assert.throws(() => verifyAdminPassword("initial-password"));
  } finally {
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    if (previousAdmin === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdmin;
    rmSync(directory, { recursive: true, force: true });
  }
});
