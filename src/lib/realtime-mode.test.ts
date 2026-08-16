import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("AI 전사 세션은 언어별 수집 페이지와 멱등 원문을 만든다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-realtime-"));
  process.env.DATABASE_PATH = join(directory, "test.db");

  try {
    const repo = await import("./repo");
    const meeting = repo.createMeeting({
      title: "AI 전사 테스트",
      langs: ["ko", "vi"],
      engine: "google",
      fallbackEngine: "openai",
      inputMode: "realtime",
    });
    assert.equal(meeting.fallbackEngine, "openai");
    assert.equal(repo.getMeeting(meeting.id)?.fallbackEngine, "openai");
    const pages = repo.getMeetingPages(meeting.id);

    assert.equal(pages.filter((page) => page.kind === "input").length, 0);
    assert.equal(pages.filter((page) => page.kind === "output").length, 2);
    const captures = pages.filter((page) => page.kind === "capture");
    assert.deepEqual(captures.map((page) => page.lang), ["ko", "vi"]);
    const capture = captures[0];

    const first = repo.insertMessageOnce({
      meetingId: meeting.id,
      pageId: capture?.id ?? null,
      lang: "ko",
      body: "안녕하세요",
      ingestKey: "capture-event-1",
    });
    const repeated = repo.insertMessageOnce({
      meetingId: meeting.id,
      pageId: capture?.id ?? null,
      lang: "ko",
      body: "중복",
      ingestKey: "capture-event-1",
    });

    assert.equal(first.inserted, true);
    assert.equal(repeated.inserted, false);
    assert.equal(repeated.message.id, first.message.id);
    assert.equal(repo.getRecentMessages(meeting.id).length, 1);

    const leases = await import("./realtime/capture-lease");
    const active = leases.claimCapture(meeting.id, capture.id, "first-device");
    assert.ok(active);
    assert.equal(leases.claimCapture(meeting.id, capture.id, "second-device"), null);
    const otherLanguage = leases.claimCapture(meeting.id, captures[1].id, "second-device");
    assert.ok(otherLanguage);
    leases.releaseCapture(capture.id, active.leaseId);
    assert.ok(leases.claimCapture(meeting.id, capture.id, "second-device"));
    leases.releaseMeetingCaptures(meeting.id);
  } finally {
    delete process.env.DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
