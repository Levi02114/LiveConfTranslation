import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

test("선택한 폴백만 미지원 언어 번역을 대신한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-fallback-"));
  const originalDatabasePath = process.env.DATABASE_PATH;
  const originalSessionSecret = process.env.SESSION_SECRET;
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "test-session-secret-for-encrypted-engine-keys";
  const originalFetch = globalThis.fetch;
  let languageCalls = 0;
  let openaiCalls = 0;
  let openaiSystemPrompt = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/v3/languages?resource=translate_text")) {
      languageCalls += 1;
      return Response.json([
        {
          lang: "ko",
          usable_as_source: true,
          usable_as_target: true,
          features: { glossary: { status: "stable" } },
        },
      ]);
    }
    if (url.includes("/chat/completions")) {
      openaiCalls += 1;
      const body = z.object({
        messages: z.array(z.object({ content: z.string() })).min(1),
      }).parse(JSON.parse(String(init?.body)));
      openaiSystemPrompt = body.messages[0].content;
      return Response.json({ choices: [{ message: { content: "안녕하세요" } }] });
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  };

  try {
    const { encryptSecret, maskSecret } = await import("../crypto");
    const { replaceGlossaryEntries, upsertEngineSecret } = await import("../repo");
    for (const [engine, key] of [
      ["deepl", "test-deepl-key"],
      ["openai", "test-openai-key"],
    ] as const) {
      upsertEngineSecret({ engine, secret: encryptSecret(key), hint: maskSecret(key) });
    }
    replaceGlossaryEntries([
      {
        terms: {
          ko: "라이브 번역",
          vi: "dịch trực tiếp",
          th: "การแปลสด",
          si: "සජීවී පරිවර්තනය",
        },
      },
    ]);

    const { translateText } = await import("./index");
    await assert.rejects(
      translateText("deepl", { text: "ආයුබෝවන්", from: "si", to: "ko" }),
      /si 언어를 지원하지 않습니다/,
    );
    assert.equal(languageCalls, 1);
    assert.equal(openaiCalls, 0);

    const result = await translateText(
      "deepl",
      { text: "ආයුබෝවන්", from: "si", to: "ko" },
      "openai",
    );
    assert.equal(result.engine, "openai");
    assert.equal(result.text, "안녕하세요");
    assert.equal(languageCalls, 1);
    assert.equal(openaiCalls, 1);
    assert.match(openaiSystemPrompt, /실시간 세션에서 원어민이 실제로 말하듯/);
    assert.match(openaiSystemPrompt, /සජීවී පරිවර්තනය/);
    assert.match(openaiSystemPrompt, /라이브 번역/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
