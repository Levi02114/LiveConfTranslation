#!/usr/bin/env node
/**
 * Silero VAD(vad-web)가 브라우저에서 필요로 하는 정적 자산을 public/vad/ 에 복사한다.
 *
 * onnxruntime-web 은 기능별 wasm 을 여러 벌 싣고 다니는데(총 78MB) 전부 넣을 수는
 * 없어 기본 simd-threaded 한 벌만 복사한다. 런타임에서 못 찾으면 neural VAD 는
 * 자동으로 RMS 감지기로 돌아간다(neural-turn-detector.ts 참고).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vad");
mkdirSync(out, { recursive: true });

const assets = [
  ["node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx", "silero_vad_v5.onnx"],
  ["node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js", "vad.worklet.bundle.min.js"],
  // wasm 백엔드는 .wasm 과 그 로더 .mjs 를 함께 요청한다 — 하나라도 없으면
  // "no available backend" 으로 초기화가 실패한다(브라우저 실측).
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.mjs"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.wasm"],
];

for (const [from, name] of assets) {
  copyFileSync(join(root, from), join(out, name));
  console.log(`[prepare-vad] ${name}`);
}
