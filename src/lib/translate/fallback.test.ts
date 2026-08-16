import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("선택한 폴백만 미지원 언어 번역을 대신한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-fallback-"));
  const originalDatabasePath = process.env.DATABASE_PATH;
  const originalSessionSecret = process.env.SESSION_SECRET;
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "test-session-secret-for-encrypted-engine-keys";
  const originalFetch = globalThis.fetch;
  let languageCalls = 0;
  let openaiCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/v2/languages?type=")) {
      languageCalls += 1;
      return Response.json([{ language: "KO" }]);
    }
    if (url.includes("/chat/completions")) {
      openaiCalls += 1;
      return Response.json({ choices: [{ message: { content: "안녕하세요" } }] });
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  };

  try {
    const { encryptSecret, maskSecret } = await import("../crypto");
    const { upsertEngineSecret } = await import("../repo");
    for (const [engine, key] of [
      ["deepl", "test-deepl-key"],
      ["openai", "test-openai-key"],
    ] as const) {
      upsertEngineSecret({ engine, secret: encryptSecret(key), hint: maskSecret(key) });
    }

    const { translateText } = await import("./index");
    await assert.rejects(
      translateText("deepl", { text: "ආයුබෝවන්", from: "si", to: "ko" }),
      /si 언어를 지원하지 않습니다/,
    );
    assert.equal(languageCalls, 2);
    assert.equal(openaiCalls, 0);

    const result = await translateText(
      "deepl",
      { text: "ආයුබෝවන්", from: "si", to: "ko" },
      "openai",
    );
    assert.equal(result.engine, "openai");
    assert.equal(result.text, "안녕하세요");
    assert.equal(languageCalls, 2);
    assert.equal(openaiCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
