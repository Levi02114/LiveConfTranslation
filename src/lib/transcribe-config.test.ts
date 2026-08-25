import assert from "node:assert/strict";
import { before, test } from "node:test";

import { singleTranscriptionProfile } from "@/lib/transcription-profile";

// repo.ts → db.ts 가 실제 사용자 DB 대신 버려지는 파일을 보게 한다.
process.env.DATABASE_PATH ??= ".tmp/test-transcribe-config.db";

let buildSingleSessionParams: typeof import("@/lib/transcribe-config").buildSingleSessionParams;
let buildCombinedSessionParams: typeof import("@/lib/transcribe-config").buildCombinedSessionParams;
let splitTranscribeHintLangs: typeof import("@/lib/transcribe-config").splitTranscribeHintLangs;

before(async () => {
  const mod = await import("@/lib/transcribe-config");
  buildSingleSessionParams = mod.buildSingleSessionParams;
  buildCombinedSessionParams = mod.buildCombinedSessionParams;
  splitTranscribeHintLangs = mod.splitTranscribeHintLangs;
});

test("단일 세션 프롬프트에 화자 이름이 들어간다", () => {
  const params = buildSingleSessionParams("ko", "테스트 세션", { speaker: "김민수" });
  assert.match(params.prompt, /The current speaker's name is "김민수"/);
});

test("화자 이름의 따옴표·줄바꿈은 걷어 낸다", () => {
  const params = buildSingleSessionParams("ko", "테스트 세션", { speaker: '김"민"\n수' });
  assert.match(params.prompt, /The current speaker's name is "김 민 수"/);
  assert.doesNotMatch(params.prompt, /\n/);
});

test("화자가 없으면 프롬프트가 바뀌지 않는다", () => {
  const params = buildSingleSessionParams("ko", "테스트 세션");
  assert.doesNotMatch(params.prompt, /current speaker/);
});

test("통합 세션 프롬프트에도 화자 이름이 들어간다", () => {
  const params = buildCombinedSessionParams(["ko", "vi"], "ko", "테스트 세션", {
    speaker: "Priya",
  });
  assert.match(params.prompt, /The current speaker's name is "Priya"/);
});

test("지역 태그는 기본 하위 태그로 환산해 힌트를 본다", () => {
  const { supported, unsupported } = splitTranscribeHintLangs(["zh-CN", "si"]);
  assert.deepEqual(supported, ["zh-CN"]);
  assert.deepEqual(unsupported, ["si"]);
  // 일부 후보만 보내면 si 를 배제하므로 힌트를 전부 생략한다.
  const params = buildCombinedSessionParams(["zh-CN", "si"], "zh-CN", "t");
  assert.deepEqual(params.languages, []);
});

test("미지원 언어만 있으면 languages 를 비운다", () => {
  const params = buildSingleSessionParams("si", "테스트 세션");
  assert.deepEqual(params.languages, []);
  assert.match(params.prompt, /Sinhala script/);
  assert.match(params.prompt, /Never romanize or transliterate Sinhala/);
  assert.match(params.prompt, /English words in Latin script/);
});

test("th 단일 세션은 gpt-transcribe 로 라우팅하고 delay 를 빼고, ko 는 live+xhigh 를 유지한다", () => {
  const th = buildSingleSessionParams("th", "테스트 세션");
  assert.equal(th.model, "gpt-transcribe");
  assert.equal(th.delay, undefined);
  const ko = buildSingleSessionParams("ko", "테스트 세션");
  assert.equal(ko.model, "gpt-live-transcribe");
  assert.equal(ko.delay, "xhigh");
  assert.deepEqual(singleTranscriptionProfile("th"), {
    model: "gpt-transcribe",
    transport: "websocket",
  });
  assert.deepEqual(singleTranscriptionProfile("vi"), {
    model: "gpt-live-transcribe",
    transport: "webrtc",
  });
  assert.deepEqual(singleTranscriptionProfile("si"), {
    model: "gpt-live-transcribe",
    transport: "websocket",
  });
});
