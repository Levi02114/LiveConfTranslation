import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("OpenAI 모델 목록은 성공 응답만 캐시하고 선택 모델과 기존 세션을 보존한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-models-"));
  const original = { database: process.env.DATABASE_PATH, secret: process.env.SESSION_SECRET, fetch: globalThis.fetch };
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "fake-model-list-test-session-secret";
  const repo = await import("./repo");
  const { getDb } = await import("./db");
  const { encryptSecret } = await import("./crypto");
  const { OPENAI_TRANSLATION_MODEL, resolveOpenaiModel } = await import("./secrets");
  const { getOpenaiModelCatalog } = await import("./openai-models");
  let calls = 0;
  let mode: "ok" | "empty" | "invalid" | "http" | "network" | "rotate" = "ok";
  const setKey = (key: string) => repo.upsertEngineSecret({ engine: "openai", secret: encryptSecret(key), hint: "fake" });
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.match(String(input), /\/models$/);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fake-model-test-key");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    if (mode === "network") throw new Error("fake-network-error");
    if (mode === "http") return new Response("private provider error", { status: 401 });
    if (mode === "empty") return Response.json({ data: [] });
    if (mode === "invalid") return Response.json({ data: [{ id: 123 }] });
    if (mode === "rotate") setKey("fake-rotated-model-test-key");
    return Response.json({ data: [{ id: "gpt-6-luna" }, { id: "gpt-4.1-mini" }, { id: "gpt-6-luna" }] });
  };
  try {
    assert.equal(resolveOpenaiModel(), OPENAI_TRANSLATION_MODEL);
    repo.replaceOpenaiModels(["cached-model"]);
    assert.deepEqual(await getOpenaiModelCatalog(false), { models: ["cached-model"], model: "gpt-6-luna", source: "cache" });
    assert.equal((await getOpenaiModelCatalog()).source, "no-key");
    assert.equal(calls, 0);
    setKey("fake-model-test-key");
    assert.deepEqual(await getOpenaiModelCatalog(), { models: ["gpt-4.1-mini", "gpt-6-luna"], model: "gpt-6-luna", source: "live" });
    assert.equal(calls, 1);
    assert.equal((await getOpenaiModelCatalog()).source, "live");
    repo.touchEngineSetting("google");
    repo.upsertEngineSetting("openai", "gpt-4.1-mini");
    assert.equal(repo.getLastEngineSetting()?.engine, "google");
    assert.equal(resolveOpenaiModel(), "gpt-4.1-mini");
    repo.touchEngineSetting("openai");
    assert.equal(resolveOpenaiModel(), "gpt-4.1-mini");
    const meeting = repo.createMeeting({ title: "Saved model", engine: "openai", translationModel: resolveOpenaiModel(),
      config: { languages: ["ko", "vi"].map((lang) => ({ lang, inputEnabled: true, outputEnabled: true })),
        speakerLabels: false, combinedInputFallbackLang: null } });
    repo.upsertEngineSetting("openai", "gpt-6-luna");
    assert.equal(repo.getMeeting(meeting.id)?.translationModel, "gpt-4.1-mini");
    for (const failure of ["empty", "invalid", "http", "network", "rotate"] as const) {
      mode = failure;
      assert.deepEqual(await getOpenaiModelCatalog(), { models: ["gpt-4.1-mini", "gpt-6-luna"], model: "gpt-6-luna", source: "error" });
    }
    repo.upsertEngineSetting("openai", "no-longer-listed-model");
    repo.deleteEngineSecret("openai");
    assert.equal((await getOpenaiModelCatalog()).model, "no-longer-listed-model");
    getDb().close(); globalThis.__meetingDb = undefined;
    assert.equal(resolveOpenaiModel(), "no-longer-listed-model");
    assert.deepEqual(repo.listOpenaiModels(), ["gpt-4.1-mini", "gpt-6-luna"]);
    repo.upsertEngineSetting("openai", null);
    assert.equal(resolveOpenaiModel(), OPENAI_TRANSLATION_MODEL);
    const { sourceEntries, getAdminStrings } = await import("./i18n");
    for (const lang of ["ko", "vi", "th", "si"]) assert.ok(getAdminStrings(lang).keys.modelPolling);
    assert.ok(sourceEntries().some(({ key }) => key === "admin.keys.modelPolling"));
    repo.upsertUiStrings("vi", [{ key: "admin.keys.modelHelp", text: "manual-model-help", origin: "manual" }]);
    assert.equal(getAdminStrings("vi").keys.modelHelp, "manual-model-help");
  } finally {
    getDb().close(); globalThis.__meetingDb = undefined;
    globalThis.fetch = original.fetch;
    if (original.database === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = original.database;
    if (original.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = original.secret;
    rmSync(directory, { recursive: true, force: true });
  }
});
