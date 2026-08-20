import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("종료된 세션만 하위 기록과 함께 실제 삭제한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-delete-"));
  process.env.DATABASE_PATH = join(directory, "test.db");

  try {
    const repo = await import("./repo");
    const meeting = repo.createMeeting({
      title: "삭제 테스트",
      config: {
        languages: [
          { lang: "ko", inputEnabled: true, outputEnabled: true },
          { lang: "vi", inputEnabled: true, outputEnabled: true },
        ],
        speakerLabels: false,
        combinedInputFallbackLang: null,
      },
      engine: "google",
    });
    assert.equal(meeting.fallbackEngine, null);
    const page = repo.getMeetingPages(meeting.id).find((item) => item.kind === "input");
    assert.ok(page);

    const message = repo.insertMessage({
      meetingId: meeting.id,
      pageId: page.id,
      lang: "ko",
      body: "안녕하세요",
    });
    repo.upsertTranslation({
      messageId: message.id,
      revision: message.revision,
      lang: "vi",
      body: "Xin chào",
      engine: "google",
      status: "ok",
    });

    repo.upsertEngineSetting("openai", "gpt-test");
    repo.touchEngineSetting("openai");
    assert.equal(repo.getLastEngineSetting()?.engine, "openai");
    assert.equal(repo.getEngineSetting("openai")?.model, "gpt-test");

    await new Promise((resolve) => setTimeout(resolve, 2));
    repo.touchEngineSetting("google");
    assert.equal(repo.getLastEngineSetting()?.engine, "google");

    assert.equal(repo.deleteClosedMeeting(meeting.id), false);
    assert.equal(repo.getRecentTranslations(meeting.id, "vi").length, 1);

    repo.closeMeeting(meeting.id);
    assert.equal(repo.deleteClosedMeeting(meeting.id), true);
    assert.equal(repo.getMeeting(meeting.id), null);
    assert.deepEqual(repo.getMeetingLangs(meeting.id), []);
    assert.deepEqual(repo.getMeetingPages(meeting.id), []);
    assert.deepEqual(repo.getRecentMessages(meeting.id), []);
    assert.deepEqual(repo.getRecentTranslations(meeting.id, "vi"), []);
  } finally {
    delete process.env.DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
