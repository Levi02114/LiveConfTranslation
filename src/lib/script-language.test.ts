import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCleanSinhalaScript,
  hasScriptEvidence,
  needsSinhalaRescue,
  scriptLanguageOf,
} from "./script-language";

const CANDIDATES = ["ko", "vi", "th", "si"];

test("문자 영역으로 언어를 구분한다", () => {
  assert.equal(scriptLanguageOf("안녕하세요, 반갑습니다.", CANDIDATES), "ko");
  assert.equal(scriptLanguageOf("สะพานนี้มีความสมบูรณ์", CANDIDATES), "th");
  assert.equal(scriptLanguageOf("මෙන්න නිදා ගන්න ආකාරය", CANDIDATES), "si");
});

test("증거가 없으면 null", () => {
  assert.equal(scriptLanguageOf("123 456", CANDIDATES), null);
  assert.equal(scriptLanguageOf("hello world", CANDIDATES), null); // 라틴이어도 성조 없으면 모름
  assert.equal(scriptLanguageOf("nếu mà qua bốn mươi chín ngày", CANDIDATES), null);
  assert.equal(scriptLanguageOf("Café à Paris", CANDIDATES), null);
  assert.equal(scriptLanguageOf("Olá, você está bem?", CANDIDATES), null);
  assert.equal(scriptLanguageOf("", CANDIDATES), null);
});

test("후보에 없는 언어는 null", () => {
  assert.equal(scriptLanguageOf("안녕하세요", ["vi", "th"]), null);
  assert.equal(scriptLanguageOf("สวัสดี", ["ko", "vi"]), null);
});

test("혼합 텍스트는 많이 나온 문자를 따른다", () => {
  assert.equal(scriptLanguageOf("회의실 번호는 302호입니다", CANDIDATES), "ko");
});

test("hasScriptEvidence: 문자 증거 유무와 검증 불가를 구분한다", () => {
  assert.equal(hasScriptEvidence("안녕하세요", "ko"), true);
  assert.equal(hasScriptEvidence("އެތްވެޑިދަވަސްއަކް", "ko"), false); // Thaana 음역
  assert.equal(hasScriptEvidence("안녕하세요", "ko-KR"), true); // 지역 태그 허용
  assert.equal(hasScriptEvidence("chào bạn", "vi"), null); // 라틴 계열은 검증 불가
});

test("hasScriptEvidence: g 플래그 정규식을 재사용해도 결과가 흔들리지 않는다", () => {
  assert.equal(hasScriptEvidence("안녕", "ko"), true);
  assert.equal(hasScriptEvidence("안녕", "ko"), true);
  assert.equal(hasScriptEvidence("abc", "ko"), false);
  assert.equal(hasScriptEvidence("안녕", "ko"), true);
});

test("싱할라어에 다른 문자나 로마자가 섞이면 보정하고 깨끗한 결과만 채택한다", () => {
  assert.equal(needsSinhalaRescue("ඔයාගේ නම මොකක්ද?"), false);
  assert.equal(needsSinhalaRescue("とかって ඔයාගේ නම මොකක්ද?"), true);
  assert.equal(needsSinhalaRescue("වරෙ saha ආයතනයන්"), true);
  assert.equal(needsSinhalaRescue("oyage nama mokadda"), true);
  assert.equal(hasCleanSinhalaScript("OpenAI ගැන කතා කරමු"), true);
  assert.equal(hasCleanSinhalaScript("とかって ඔයාගේ නම මොකක්ද?"), false);
});
