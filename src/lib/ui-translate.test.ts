import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("credit failures preserve registered languages, stop repeated requests and keep manual text", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-ui-translation-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "fake-ui-translation-secret";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { code: "insufficient_quota" } }, { status: 429 });
  };
  const repo = await import("./repo");
  const { getDb } = await import("./db");
  const { encryptSecret } = await import("./crypto");
  const { getAdminStrings, getStrings, sourceEntries } = await import("./i18n");
  const { translateUiStrings } = await import("./ui-translate");
  try {
    repo.upsertEngineSecret({ engine: "openai", secret: encryptSecret("fake-test-key"), hint: "fake" });
    repo.addLanguage("en");
    repo.upsertUiStrings("en", [{ key: "admin.languages.registered", text: "My registered label", origin: "manual" }]);
    const result = await translateUiStrings("en", "openai", { keepManual: true });
    assert.equal(result.translated, 0);
    assert.equal(result.failed, sourceEntries().filter((entry) => entry.source.trim()).length - 1);
    assert.equal(calls, 1, "a billing failure must not call the same provider for every remaining batch");
    assert(repo.listLanguages().some((language) => language.code === "en"));
    assert.deepEqual(getStrings("en"), getStrings("ko"));
    assert.equal(getAdminStrings("en").languages.registered, "My registered label");
    for (const lang of ["ko", "vi", "th", "si"]) {
      const strings = getAdminStrings(lang).languages;
      assert(strings.loading && strings.registered && strings.translationIncomplete);
    }
    for (const key of ["loading", "registered", "translationIncomplete"]) {
      assert(sourceEntries().some((entry) => entry.key === `admin.languages.${key}`));
    }
    repo.deleteLanguage("en");
    assert(!repo.hasLanguage("en"));
    repo.addLanguage("en");
    assert(repo.hasLanguage("en"));
  } finally {
    globalThis.fetch = originalFetch;
    getDb().close();
    globalThis.__meetingDb = undefined;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
