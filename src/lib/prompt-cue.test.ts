import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("동적 언어 지시문을 한 번만 생성하고 실패는 명시적 갱신 때 재시도한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-prompt-cue-"));
  const originalDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(directory, "test.db");

  try {
    const repo = await import("./repo");
    const cues = await import("./prompt-cue");
    repo.addLanguage("fr");
    repo.addLanguage("de");

    let generated = 0;
    const generateFrench = async () => {
      generated += 1;
      return "Traduisez dans un français naturel.";
    };
    const [first, second] = await Promise.all([
      cues.ensureLanguagePromptCue("fr", generateFrench),
      cues.ensureLanguagePromptCue("fr", generateFrench),
    ]);
    assert.equal(first, second);
    assert.equal(generated, 1);
    assert.equal(repo.getLanguagePromptCue("fr")?.engine, "openai");

    let failures = 0;
    const fail = async () => {
      failures += 1;
      throw new Error("offline");
    };
    assert.equal(await cues.ensureLanguagePromptCue("de", fail), null);
    assert.equal(await cues.ensureLanguagePromptCue("de", fail), null);
    assert.equal(failures, 1);

    await cues.refreshLanguagePromptCue("de", "google", async () =>
      "Übersetzen Sie in natürliches Deutsch.",
    );
    assert.match(cues.resolveLanguagePromptCue("de") ?? "", /Deutsch/);

    repo.deleteLanguage("de");
    assert.equal(repo.getLanguagePromptCue("de"), null);
  } finally {
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
