/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { installedLocalAi, recommendedModels, stringsFor } = require("./local-ai.cjs");

test("시스템 메모리에 맞춰 보수적인 로컬 모델을 추천한다", () => {
  assert.deepEqual(recommendedModels(8 * 1024 ** 3), { translation: "4b", transcription: "small" });
  assert.deepEqual(recommendedModels(24 * 1024 ** 3), { translation: "12b", transcription: "medium" });
  assert.deepEqual(recommendedModels(48 * 1024 ** 3), { translation: "27b", transcription: "medium" });
});

test("로컬 AI 설치 문구는 기본 4개 언어에서 같은 키를 제공한다", () => {
  const keys = Object.keys(stringsFor("ko")).sort();
  assert.equal(stringsFor("ko").httpsFailed, "로컬 HTTPS 설정 실패");
  for (const locale of ["en", "vi", "th", "si"]) {
    assert.deepEqual(Object.keys(stringsFor(locale)).sort(), keys);
  }
});

test("설치기가 기록한 로컬 AI 경로를 읽는다", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lct-local-ai-"));
  try {
    const files = ["translation.gguf", "transcription.bin", "llama.exe", "whisper.exe"];
    for (const file of files) writeFileSync(path.join(directory, file), "test");
    mkdirSync(path.join(directory, "resources"));
    writeFileSync(path.join(directory, "resources", "local-ai-install.conf"), [
      `modelDir=${directory}`,
      `tempDir=${directory}`,
      "translationModel=4b",
      "transcriptionModel=small",
      `translationModelPath=${path.join(directory, files[0])}`,
      `transcriptionModelPath=${path.join(directory, files[1])}`,
      `llamaServer=${path.join(directory, files[2])}`,
      `whisperServer=${path.join(directory, files[3])}`,
      "useGpu=1",
    ].join("\n"));
    assert.equal(installedLocalAi(path.join(directory, "resources")).translationModel, "4b");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
