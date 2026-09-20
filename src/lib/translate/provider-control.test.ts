import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

test("fake providers exercise retry-after, permanent errors, fallback, concurrency and circuit recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-provider-control-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "test-only-provider-control-secret";
  const originalFetch = globalThis.fetch;
  let googleStatus = 200;
  let openaiStatus = 200;
  let googleCalls = 0;
  let openaiCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("translation.googleapis.com")) {
      googleCalls++;
      return googleStatus === 200 ? Response.json({ data: { translations: [{ translatedText: "xin chào" }] } }) :
        new Response("private-provider-error", { status: googleStatus, headers: { "Retry-After": "0.05" } });
    }
    if (String(url).includes("/chat/completions")) {
      openaiCalls++;
      return openaiStatus === 200 ? Response.json({ choices: [{ message: { content: "xin chào" } }] }) :
        Response.json({ error: { code: "insufficient_quota" } }, { status: openaiStatus });
    }
    throw new Error("unexpected test provider");
  };
  const repo = await import("../repo");
  const { getDb } = await import("../db");
  const { encryptSecret } = await import("../crypto");
  const { callProvider, providerStatus } = await import("./provider-control");
  const { translateText, TranslationError, isTransientTranslationError } = await import("./index");
  const worker = await import("../translation-worker");
  try {
    for (const engine of ["google", "openai"] as const) repo.upsertEngineSecret({ engine, secret: encryptSecret("fake-test-key"), hint: "fake" });
    googleStatus = 429;
    await assert.rejects(translateText("google", { text: "안녕", from: "ko", to: "vi" }), (error) => {
      assert.ok(error instanceof TranslationError);
      assert.equal(error.retryAfterMs, 50);
      assert.equal(error.code, "provider-rate-limit");
      assert.equal(isTransientTranslationError(error), true);
      assert.doesNotMatch(error.message, /private-provider-error/);
      return true;
    });
    assert.equal(openaiCalls, 0);
    googleStatus = 401;
    assert.equal((await translateText("google", { text: "안녕", from: "ko", to: "vi" }, "openai")).engine, "openai");
    assert.equal(googleCalls, 2);
    assert.equal(openaiCalls, 1);
    openaiStatus = 429;
    await assert.rejects(translateText("openai", { text: "안녕", from: "ko", to: "vi" }), (error) => {
      assert.ok(error instanceof TranslationError);
      assert.equal(error.code, "openai-billing-limit");
      assert.equal(isTransientTranslationError(error), false);
      return true;
    });

    globalThis.__translationProviders?.clear();
    repo.setSecurityLimits({ ...repo.getSecurityLimits(), translationOnline: 1 });
    let release = () => {};
    const running = callProvider("google", undefined, () => new Promise<string>((resolve) => { release = () => resolve("ok"); }));
    await assert.rejects(callProvider("google", undefined, async () => "not called"), /provider-busy/);
    release();
    await running;
    for (let index = 0; index < 5; index++) await assert.rejects(callProvider("google", undefined, async () => { throw new Error("temporary"); }));
    await assert.rejects(callProvider("google", undefined, async () => "not called"), /provider-paused/);
    const state = globalThis.__translationProviders!.get("google")!;
    state.blockedUntil = Date.now() - 1;
    const probe = callProvider("google", undefined, () => new Promise<string>((resolve) => { release = () => resolve("recovered"); }));
    await assert.rejects(callProvider("google", undefined, async () => "parallel probe"), /provider-paused/);
    release();
    assert.equal(await probe, "recovered");
    assert.equal(providerStatus().google.blockedUntil, 0);

    const meeting = repo.createMeeting({ title: "retry", engine: "google", config: {
      languages: ["ko", "vi"].map((lang) => ({ lang, inputEnabled: true, outputEnabled: true })), speakerLabels: false, combinedInputFallbackLang: null,
    } });
    repo.insertMessage({ meetingId: meeting.id, pageId: null, lang: "ko", body: "영속 재시도" });
    googleStatus = 429;
    const before = googleCalls;
    worker.startTranslationWorker();
    while (googleCalls === before) await delay(5);
    googleStatus = 200;
    for (let index = 0; index < 200 && repo.getRecentCombined(meeting.id)[0]?.translations.length !== 1; index++) await delay(10);
    assert.equal(repo.getRecentCombined(meeting.id)[0]?.translations[0]?.status, "ok");
    assert.equal(googleCalls, before + 2);
    assert.deepEqual(repo.getTranslationJobCounts(meeting.id), { pending: 0, running: 0, failed: 0 });
  } finally {
    worker.stopTranslationWorker();
    globalThis.fetch = originalFetch;
    getDb().close();
    globalThis.__meetingDb = undefined;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
