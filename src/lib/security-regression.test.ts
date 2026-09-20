import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isAdminFromCookieHeader } from "./auth-core";
import { inputFingerprint } from "./input-fingerprint";
import { rateLimit } from "./security-limits";
import { decodeHtmlEntities } from "./translate/google";

test("malformed cookies and invalid numeric entities are harmless", () => {
  for (const cookie of ["lct_admin=%", "lct_admin=%E0%A4", "lct_admin=%FF", "lct_admin=expired"])
    assert.equal(isAdminFromCookieHeader(cookie), false);
  assert.equal(decodeHtmlEntities("&#1114112; &#xD800; &#999999999999999999999; &amp;#39;"), "&#1114112; &#xD800; &#999999999999999999999; &#39;");
  assert.equal(decodeHtmlEntities("&#39; &#x1F600;"), "' 😀");
  assert.equal(rateLimit("test:burst", 5, 2, 1000), 0);
  assert.equal(rateLimit("test:burst", 5, 2, 1000), 0);
  assert.equal(rateLimit("test:burst", 5, 2, 1000), 1);
  assert.equal(rateLimit("test:burst", 5, 2, 1200), 0);
});

test("scoped retries, atomic admission, durable leases and revision-safe completion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-security-"));
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(directory, "test.db");
  const repo = await import("./repo");
  const { getDb } = await import("./db");
  try {
    const makeMeeting = () => repo.createMeeting({ title: "isolated", engine: "google", config: {
      languages: ["ko", "vi"].map((lang) => ({ lang, inputEnabled: true, outputEnabled: true })),
      speakerLabels: false, combinedInputFallbackLang: null,
    } });
    const first = makeMeeting();
    const second = makeMeeting();
    const pages = repo.getMeetingPages(first.id).filter((page) => page.kind === "input");
    const other = repo.getMeetingPages(second.id).find((page) => page.kind === "input")!;
    const request = { meetingId: first.id, pageId: pages[0].id, lang: "ko", body: "original", speakerName: "speaker", ingestKey: "same-request-key" };
    const accepted = repo.insertMessageOnce(request);
    // Exercise the migration on a legacy global index with missing fingerprints.
    getDb().exec("DROP INDEX idx_messages_ingest_page; DROP INDEX idx_messages_ingest_session; CREATE UNIQUE INDEX idx_messages_ingest_key ON messages(ingest_key); UPDATE messages SET input_fingerprint = NULL");
    repo.migrateSecurity(getDb());
    repo.migrateSecurity(getDb());
    assert.equal(repo.insertMessageOnce(request).message.id, accepted.message.id);
    assert.throws(() => repo.insertMessageOnce({ ...request, body: "different" }), /idempotency-conflict/);
    const crossPage = repo.insertMessageOnce({ ...request, pageId: pages[1].id, body: "different page" });
    const crossSession = repo.insertMessageOnce({ ...request, meetingId: second.id, pageId: other.id, body: "different session" });
    const nullPage = repo.insertMessageOnce({ ...request, pageId: null, body: "null page" });
    assert.equal(new Set([accepted, crossPage, crossSession, nullPage].map((row) => row.message.id)).size, 4);
    assert.equal(repo.insertMessageOnce({ ...request, pageId: null, body: "null page" }).inserted, false);
    assert.throws(() => repo.insertMessageOnce({ ...request, pageId: other.id, ingestKey: "foreign-page" }), /page-disabled/);

    const firstJob = repo.claimTranslationJob(["google"]);
    assert.ok(firstJob);
    assert.equal(firstJob.message_id, accepted.message.id);
    const edited = repo.editMessage({ pageId: pages[0].id, messageId: accepted.message.id, body: "edited", revision: 0 });
    assert.equal(edited.ok, true);
    assert.equal(repo.insertMessageOnce(request).message.body, "edited");
    assert.equal(repo.finishTranslationJob(firstJob, { body: "stale", engine: "google" }), null);
    assert.equal(repo.upsertTranslation({ messageId: accepted.message.id, revision: 0, lang: "vi", body: "stale", engine: "google", status: "ok" }), null);

    const initial = "before rewriting";
    const fingerprint = inputFingerprint("ko", initial);
    const rewritten = { ...request, ingestKey: "rewritten-request", body: "rewritten", fingerprint };
    const transcript = repo.insertMessageOnce(rewritten);
    assert.equal(repo.insertMessageOnce({ ...rewritten, body: "another rewrite" }).message.id, transcript.message.id);

    const running = repo.claimTranslationJob(["google"]);
    assert.ok(running);
    repo.recoverTranslationJobs(Date.now() + 121000);
    const reclaimed = repo.claimTranslationJob(["google"]);
    assert.ok(reclaimed);
    assert.equal(reclaimed.id, running.id);
    assert.notEqual(reclaimed.lease_token, running.lease_token);
    assert.equal(repo.finishTranslationJob(running, { body: "stale lease", engine: "google" }), null);
    repo.closeMeeting(first.id);
    assert.throws(() => repo.insertMessageOnce({ ...request, ingestKey: "late-request" }), /session-closed/);
    assert.notEqual(repo.finishTranslationJob(reclaimed, { body: "accepted before close", engine: "google" }), null);

    const before = repo.getRecentMessages(second.id).length;
    repo.setSecurityLimits({ ...repo.getSecurityLimits(), jobsTotal: 1 });
    assert.throws(() => repo.insertMessageOnce({ ...request, meetingId: second.id, pageId: other.id, ingestKey: "queue-overflow" }), /queue-full/);
    assert.equal(repo.getRecentMessages(second.id).length, before);
    assert.equal(repo.insertMessageOnce({ ...request, meetingId: second.id, pageId: other.id, body: "different session" }).inserted, false);
    assert.equal(repo.deleteClosedMeeting(first.id), true);
    assert.deepEqual(repo.getTranslationJobCounts(first.id), { pending: 0, running: 0, failed: 0 });
    const i18n = await import("./i18n");
    assert.ok(i18n.sourceEntries().some((entry) => entry.key === "admin.security.connectionsTotal"));
    assert.ok(i18n.sourceEntries().some((entry) => entry.key === "admin.security.siteManagement"));
    assert.ok(i18n.sourceEntries().some((entry) => entry.key === "admin.security.chooseSession"));
    assert.ok(i18n.sourceEntries().some((entry) => entry.key === "ui.input.retained"));
    for (const lang of ["ko", "vi", "th", "si"]) {
      assert.ok(i18n.getAdminStrings(lang).security.title);
      assert.ok(i18n.getAdminStrings(lang).security.siteManagement);
      assert.ok(i18n.getStrings(lang).input.retry);
    }
    repo.upsertUiStrings("vi", [{ key: "admin.security.title", text: "Manual security title", origin: "manual" }]);
    repo.upsertUiStrings("vi", [{ key: "admin.security.siteManagement", text: "Manual site title", origin: "manual" }]);
    assert.equal(i18n.getAdminStrings("vi").security.siteManagement, "Manual site title");
    assert.equal(i18n.getAdminStrings("vi").security.title, "Manual security title");
    repo.migrateSecurity(getDb());
    assert.equal(i18n.getAdminStrings("vi").security.title, "Manual security title");
  } finally {
    getDb().close();
    globalThis.__meetingDb = undefined;
    if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
