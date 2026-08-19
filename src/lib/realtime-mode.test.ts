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

    assert.deepEqual(repo.getMeetingLanguageConfigs(meeting.id), [
      { lang: "ko", inputEnabled: true, outputEnabled: false },
      { lang: "vi", inputEnabled: true, outputEnabled: false },
    ]);
    assert.equal(repo.getMeeting(meeting.id)?.speakerLabels, true);
    assert.equal(repo.isPageEnabled(pages.find((page) => page.kind === "output")!), false);

    const configured = repo.updateMeetingConfig(
      meeting.id,
      [
        { lang: "ko", inputEnabled: true, outputEnabled: true },
        { lang: "vi", inputEnabled: true, outputEnabled: true },
      ],
      true,
      "ko",
    );
    assert.equal(configured.ok, true);
    assert.deepEqual(repo.getMeetingActiveLangs(meeting.id), ["ko", "vi"]);
    const combinedInput = repo.getMeetingPages(meeting.id).find(
      (page) => page.kind === "combined-input",
    );
    assert.equal(combinedInput?.lang, "ko");

    const preset = repo.upsertSessionPreset({
      name: "통역 행사",
      config: {
        languages: repo.getMeetingLanguageConfigs(meeting.id),
        speakerLabels: true,
        combinedInputFallbackLang: "ko",
      },
    });
    assert.equal(repo.listSessionPresets()[0]?.name, "통역 행사");
    assert.equal(repo.listSessionPresets()[0]?.combinedInputFallbackLang, "ko");

    const first = repo.insertMessageOnce({
      meetingId: meeting.id,
      pageId: input?.id ?? null,
      lang: "ko",
      body: "안녕하세요",
      speakerName: "김속기",
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
    assert.equal(repeated.message.speakerName, "김속기");
    assert.equal(repo.getRecentMessages(meeting.id).length, 1);
    assert.equal(repo.getRecentCombined(meeting.id)[0]?.speakerName, "김속기");
    assert.deepEqual(
      repo.updateMeetingConfig(meeting.id, repo.getMeetingLanguageConfigs(meeting.id), false),
      { ok: false, reason: "locked" },
    );
    assert.equal(repo.deleteSessionPreset(preset.id), true);

    const leases = await import("./realtime/capture-lease");
    const active = leases.claimCapture(meeting.id, input.id, "first-device");
    assert.ok(active);
    const sameLanguage = leases.claimCapture(meeting.id, input.id, "second-device");
    assert.ok(sameLanguage);
    assert.notEqual(sameLanguage.leaseId, active.leaseId);
    const otherLanguage = leases.claimCapture(meeting.id, inputs[1].id, "second-device");
    assert.ok(otherLanguage);
    leases.releaseCapture(input.id, active.leaseId);
    assert.ok(leases.claimCapture(meeting.id, input.id, "second-device"));
    leases.releaseMeetingCaptures(meeting.id);

    const exclusive = leases.claimExclusiveCapture(meeting.id, input.id, "first-device");
    assert.ok(exclusive);
    assert.equal(leases.claimExclusiveCapture(meeting.id, input.id, "second-device"), null);
    leases.releaseCapture(input.id, exclusive.leaseId);
    assert.ok(leases.claimExclusiveCapture(meeting.id, input.id, "second-device"));
  } finally {
    delete process.env.DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
