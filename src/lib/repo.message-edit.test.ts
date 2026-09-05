import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("원문 입력 채널만 수정하며 이전 번역과 revision을 폐기한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-edit-"));
  process.env.DATABASE_PATH = join(directory, "test.db");

  try {
    const repo = await import("./repo");
    const meeting = repo.createMeeting({
      title: "수정 테스트",
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
    const pages = repo.getMeetingPages(meeting.id).filter((page) => page.kind === "input");
    const ko = pages.find((page) => page.lang === "ko")!;
    const vi = pages.find((page) => page.lang === "vi")!;
    const message = repo.insertMessage({
      meetingId: meeting.id,
      pageId: ko.id,
      lang: "ko",
      body: "수정 전",
    });
    assert.ok(repo.upsertTranslation({
      messageId: message.id,
      revision: 0,
      lang: "vi",
      body: "Trước khi chỉnh sửa",
      engine: "google",
      status: "ok",
    }));

    assert.deepEqual(
      repo.editMessage({ pageId: vi.id, messageId: message.id, body: "침범", revision: 0 }),
      { ok: false, reason: "not-found" },
    );
    const edited = repo.editMessage({
      pageId: ko.id,
      messageId: message.id,
      body: "수정 후",
      revision: 0,
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.message.revision, 1);
    assert.ok(edited.message.editedAt);
    assert.deepEqual(repo.getRecentTranslations(meeting.id, "vi"), []);
    assert.deepEqual(
      repo.editMessage({ pageId: ko.id, messageId: message.id, body: "충돌", revision: 0 }),
      { ok: false, reason: "conflict" },
    );
    assert.equal(repo.upsertTranslation({
      messageId: message.id,
      revision: 0,
      lang: "vi",
      body: "낡은 번역",
      engine: "google",
      status: "ok",
    }), null);
    assert.ok(repo.upsertTranslation({
      messageId: message.id,
      revision: 1,
      lang: "vi",
      body: "Sau khi chỉnh sửa",
      engine: "google",
      status: "ok",
    }));
    const combined = repo.getRecentCombined(meeting.id)[0];
    assert.equal(combined?.sourceBody, "수정 후");
    assert.equal(repo.getCombinedSince(meeting.id, combined!.updatedAt)[0]?.sourceBody, "수정 후");
    assert.deepEqual(repo.getCombinedSince(meeting.id, combined!.updatedAt + 1), []);

    repo.closeMeeting(meeting.id);
    assert.deepEqual(
      repo.editMessage({ pageId: ko.id, messageId: message.id, body: "종료 후", revision: 1 }),
      { ok: false, reason: "closed" },
    );
  } finally {
    delete process.env.DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
