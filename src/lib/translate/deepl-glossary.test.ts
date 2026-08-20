import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

test("DeepL 지원 언어쌍에는 동기화한 단어집 ID를 붙인다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-deepl-glossary-"));
  const originalDatabasePath = process.env.DATABASE_PATH;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "test-session-secret-for-encrypted-engine-keys";
  let glossaryId: string | undefined;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/v3/languages?resource=translate_text")) {
      return Response.json(
        ["ko", "vi"].map((lang) => ({
          lang,
          usable_as_source: true,
          usable_as_target: true,
          features: { glossary: { status: "stable" } },
        })),
      );
    }
    if (url.endsWith("/v3/glossaries") && !init?.method) {
      return Response.json({ glossaries: [] });
    }
    if (url.endsWith("/v3/glossaries") && init?.method === "POST") {
      return Response.json({ glossary_id: "glossary-1" }, { status: 201 });
    }
    if (url.endsWith("/v3/glossaries/glossary-1/dictionaries")) {
      return Response.json({ entry_count: 1 });
    }
    if (url.endsWith("/v2/translate")) {
      glossaryId = z.object({ glossary_id: z.string().optional() })
        .parse(JSON.parse(String(init?.body))).glossary_id;
      return Response.json({ translations: [{ text: "bản dịch trực tiếp" }] });
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  };

  try {
    const { encryptSecret, maskSecret } = await import("../crypto");
    const { replaceGlossaryEntries, upsertEngineSecret } = await import("../repo");
    upsertEngineSecret({
      engine: "deepl",
      secret: encryptSecret("test-deepl-key"),
      hint: maskSecret("test-deepl-key"),
    });
    replaceGlossaryEntries([
      { terms: { ko: "실시간 번역", vi: "bản dịch trực tiếp", th: "unused", si: "unused" } },
    ]);

    const { translateText } = await import("./index");
    const result = await translateText("deepl", {
      text: "실시간 번역",
      from: "ko",
      to: "vi",
    });

    assert.equal(result.text, "bản dịch trực tiếp");
    assert.equal(glossaryId, "glossary-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
