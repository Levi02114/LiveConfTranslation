import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_UI } from "@/lib/i18n-builtin";
import { voiceLevelHint } from "./voice-level-meter";

const strings = FALLBACK_UI.capture;
const meter = { level: 0, clipping: false, noSignal: false, tooQuiet: false };

test("computer sound never asks to move the microphone closer and explains silence instead", () => {
  assert.equal(voiceLevelHint({ ...meter, tooQuiet: true }, strings), strings.levelTooQuiet);
  assert.equal(voiceLevelHint({ ...meter, tooQuiet: true }, strings, true), null);
  assert.equal(voiceLevelHint({ ...meter, noSignal: true }, strings), strings.noSignal);
  // Node 의 navigator.userAgent 는 Mac 이 아니므로 일반 안내가 나온다.
  assert.equal(voiceLevelHint({ ...meter, noSignal: true }, strings, true), strings.systemAudioSilent);
  assert.equal(voiceLevelHint({ ...meter, clipping: true }, strings, true), strings.levelClipping);
});
