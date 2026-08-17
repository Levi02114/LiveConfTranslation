import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("세션은 언어별 입력 페이지를 만들고 음성 전사를 멱등 저장한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-realtime-"));
  process.env.DATABASE_PATH = join(directory, "test.db");

  try {
    const repo = await import("./repo");
    const meeting = repo.createMeeting({
      title: "AI 전사 테스트",
      langs: ["ko", "vi"],
      engine: "google",
      fallbackEngine: "openai",
    });
    assert.equal(meeting.fallbackEngine, "openai");
    assert.equal(repo.getMeeting(meeting.id)?.fallbackEngine, "openai");
    const pages = repo.getMeetingPages(meeting.id);

    const inputs = pages.filter((page) => page.kind === "input");
    assert.deepEqual(inputs.map((page) => page.lang), ["ko", "vi"]);
    assert.equal(pages.filter((page) => page.kind === "output").length, 2);
    assert.equal(pages.filter((page) => page.kind === "capture").length, 0);
    const input = inputs[0];

    const first = repo.insertMessageOnce({
      meetingId: meeting.id,
      pageId: input?.id ?? null,
      lang: "ko",
      body: "안녕하세요",
      ingestKey: "capture-event-1",
    });
    const repeated = repo.insertMessageOnce({
      meetingId: meeting.id,
      pageId: input?.id ?? null,
      lang: "ko",
      body: "중복",
      ingestKey: "capture-event-1",
    });

    assert.equal(first.inserted, true);
    assert.equal(repeated.inserted, false);
    assert.equal(repeated.message.id, first.message.id);
    assert.equal(repo.getRecentMessages(meeting.id).length, 1);

    const leases = await import("./realtime/capture-lease");
    const active = leases.claimCapture(meeting.id, input.id, "first-device");
    assert.ok(active);
    assert.equal(leases.claimCapture(meeting.id, input.id, "second-device"), null);
    const otherLanguage = leases.claimCapture(meeting.id, inputs[1].id, "second-device");
    assert.ok(otherLanguage);
    leases.releaseCapture(input.id, active.leaseId);
    assert.ok(leases.claimCapture(meeting.id, input.id, "second-device"));
    leases.releaseMeetingCaptures(meeting.id);
  } finally {
    delete process.env.DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
