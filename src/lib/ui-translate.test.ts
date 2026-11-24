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

test("startup autofill translates only missing UI strings for added languages and keeps manual text", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-ui-autofill-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "fake-ui-autofill-secret";
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const items: string[] = JSON.parse(body.messages.at(-1).content).items;
    requested.push(...items);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: items.map((text) => `EN ${text}`) }) } }] });
  };
  const repo = await import("./repo");
  const { getDb } = await import("./db");
  const { encryptSecret } = await import("./crypto");
  const { getStrings, sourceEntries } = await import("./i18n");
  const { fillMissingUiStrings } = await import("./ui-autofill");
  try {
    repo.upsertEngineSecret({ engine: "openai", secret: encryptSecret("fake-test-key"), hint: "fake" });
    repo.addLanguage("en");
    // 업데이트 전 상태: 새 문구(ui.zoomChat.*)만 빠져 있고, 하나는 사람이 고쳐 둔 문구다.
    const old = sourceEntries().filter((entry) => entry.source.trim() && !entry.key.startsWith("ui.zoomChat."));
    repo.upsertUiStrings("en", old.map((entry) => ({ key: entry.key, text: `old ${entry.key}`, origin: "machine" as const })));
    repo.upsertUiStrings("en", [{ key: "ui.zoomChat.label", text: "Zoom chat (manual)", origin: "manual" }]);
    await fillMissingUiStrings();
    const chat = getStrings("en").zoomChat;
    assert.equal(chat.label, "Zoom chat (manual)", "manual text is never overwritten");
    assert.equal(chat.off, `EN ${getStrings("ko").zoomChat.off}`);
    assert.equal(requested.length, 4, "only the missing strings are sent for translation");
    assert.equal(getStrings("en").capture.start, "old ui.capture.start", "existing machine text stays");
    requested.length = 0;
    await fillMissingUiStrings();
    assert.equal(requested.length, 0, "nothing is requested once complete");
  } finally {
    globalThis.fetch = originalFetch;
    getDb().close();
    globalThis.__meetingDb = undefined;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
