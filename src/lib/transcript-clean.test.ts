import assert from "node:assert/strict";
import test from "node:test";

import { cleanTranscript } from "./transcript-clean";

test("빈 전사와 의미 없는 제어문자만 제거한다", () => {
  assert.equal(cleanTranscript("  \u0000\u200B\uFEFF "), null);
  assert.equal(cleanTranscript("  안녕하세요.\u0000  "), "안녕하세요.");
});

test("짧은 표현·반복·태국어 공백을 그대로 보존한다", () => {
  assert.equal(cleanTranscript("Thank you."), "Thank you.");
  assert.equal(cleanTranscript("Thanks."), "Thanks.");
  assert.equal(cleanTranscript("Bye."), "Bye.");
  assert.equal(cleanTranscript("ขอบคุณครับ"), "ขอบคุณครับ");
  assert.equal(cleanTranscript("ขอบคุณค่ะ"), "ขอบคุณค่ะ");
  assert.equal(cleanTranscript("ස්තූතියි"), "ස්තූතියි");
  assert.equal(cleanTranscript("네 네 네 네 네"), "네 네 네 네 네");
  assert.equal(cleanTranscript("สะพาน นี้ มี ความ สมบูรณ์"), "สะพาน นี้ มี ความ สมบูรณ์");
});

test("NFC로 정규화하되 ZWJ·ZWNJ와 내부 줄바꿈은 보존한다", () => {
  assert.equal(cleanTranscript("a\u0301"), "á");
  assert.equal(cleanTranscript("අ\u200Cබ\u200Dක"), "අ\u200Cබ\u200Dක");
  assert.equal(cleanTranscript("첫 줄\n둘째 줄"), "첫 줄\n둘째 줄");
});
