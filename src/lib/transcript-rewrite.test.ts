import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

test("전사문을 최근 문맥과 단어장으로 재작성하고 실패하면 원문을 유지한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "liveconf-transcript-rewrite-"));
  const originalDatabasePath = process.env.DATABASE_PATH;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "test-session-secret-for-transcript-rewrite";
  let calls = 0;
  let requestBody: unknown;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body));
    return calls === 1
      ? Response.json({ choices: [{ message: { content: JSON.stringify({ text: "LiveConfTranslation을 테스트합니다." }) } }] })
      : new Response("unavailable", { status: 503 });
  };
  console.warn = () => {};

  try {
    const { encryptSecret, maskSecret } = await import("./crypto");
    const repo = await import("./repo");
    repo.upsertEngineSecret({
      engine: "openai",
      secret: encryptSecret("test-openai-key"),
      hint: maskSecret("test-openai-key"),
    });
    repo.replaceGlossaryEntries([{ terms: { ko: "LiveConfTranslation", vi: "LiveConfTranslation" } }]);
    const created = repo.createMeeting({
      title: "음성 인식 테스트",
      config: {
        languages: [
          { lang: "ko", inputEnabled: true, outputEnabled: true },
          { lang: "vi", inputEnabled: false, outputEnabled: true },
        ],
        speakerLabels: true,
        combinedInputFallbackLang: null,
      },
      engine: "openai",
      fallbackEngine: null,
      translationModel: "gpt-5.6-luna",
      transcriptionProvider: "openai",
    });
    repo.updateTranscriptionContext(created.id, "제품 이름과 발표자 이름을 정확히 기록");
    for (const body of ["제외할 오래된 문장", "첫 번째", "두 번째", "세 번째", "네 번째"]) {
      repo.insertMessage({ meetingId: created.id, pageId: null, lang: "ko", body });
    }
    const meeting = repo.getMeeting(created.id);
    assert.ok(meeting);

    const { rewriteTranscript } = await import("./transcript-rewrite");
    const original = "라이브 컨퍼런스 트랜슬레이션을 테스투합니다.";
    assert.equal(
      await rewriteTranscript({ meeting, lang: "ko", body: original, speakerName: "레비" }),
      "LiveConfTranslation을 테스트합니다.",
    );

    const parsed = z.object({
      messages: z.tuple([
        z.object({ content: z.string() }),
        z.object({ content: z.string() }),
      ]),
    }).parse(requestBody);
    const references = JSON.parse(parsed.messages[1].content);
    assert.deepEqual(references.recentContext.map((row: { text: string }) => row.text), [
      "첫 번째", "두 번째", "세 번째", "네 번째",
    ]);
    assert.deepEqual(references.glossary, ["LiveConfTranslation"]);
    assert.equal(references.sessionContext, "제품 이름과 발표자 이름을 정확히 기록");
    assert.match(parsed.messages[0].content, /Do not censor/);

    assert.equal(
      await rewriteTranscript({ meeting, lang: "ko", body: original }),
      original,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
