import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("로컬 AI 실행 파일을 시작하지 못하면 즉시 실패한다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-local-runtime-"));
  const binary = join(directory, "llama-server");
  const model = join(directory, "model.gguf");
  writeFileSync(binary, "not executable");
  writeFileSync(model, "test");
  chmodSync(binary, 0o644);
  process.env.LOCAL_LLAMA_SERVER_PATH = binary;
  process.env.LOCAL_TRANSLATION_MODEL_PATH = model;

  try {
    const { ensureLocalTranslationRuntime } = await import("@/lib/local-runtime");
    await assert.rejects(ensureLocalTranslationRuntime(), /EACCES/);
    await assert.rejects(ensureLocalTranslationRuntime(), /EACCES/);
  } finally {
    delete process.env.LOCAL_LLAMA_SERVER_PATH;
    delete process.env.LOCAL_TRANSLATION_MODEL_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
