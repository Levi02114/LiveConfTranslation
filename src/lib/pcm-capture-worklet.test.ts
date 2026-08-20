import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

type Processor = {
  port: { postMessage: (message: { pcm: ArrayBuffer; rms: number; peak: number }) => void };
  process: (inputs: Float32Array[][]) => boolean;
};

test("24kHz 입력은 추가 리샘플링 없이 같은 샘플 수의 PCM을 만든다", () => {
  const constructors: Array<new () => Processor> = [];
  class AudioWorkletProcessor {
    port = { postMessage: () => {} };
  }
  vm.runInNewContext(
    readFileSync("public/pcm-capture-worklet.js", "utf8"),
    {
      AudioWorkletProcessor,
      Float32Array,
      Int16Array,
      Math,
      sampleRate: 24_000,
      registerProcessor: (_name: string, value: new () => Processor) => constructors.push(value),
    },
  );
  assert.ok(constructors[0]);
  const processor = new constructors[0]();
  const results: Array<{ pcm: ArrayBuffer; rms: number; peak: number }> = [];
  processor.port.postMessage = (message: { pcm: ArrayBuffer; rms: number; peak: number }) => {
    results.push(message);
  };
  assert.equal(processor.process([[Float32Array.from({ length: 128 }, () => 0.25)]]), true);
  const output = results[0];
  assert.ok(output);
  assert.equal(new Int16Array(output.pcm).length, 128);
  assert.ok(output.rms > 0);
  assert.equal(output.peak, 0.25);
});
