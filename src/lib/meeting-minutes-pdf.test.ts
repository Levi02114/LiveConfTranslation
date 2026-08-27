import assert from "node:assert/strict";
import test from "node:test";

import { selectMinutesLines } from "./log-format";
import { groupMeetingLogLines, renderMeetingMinutesPdf } from "./meeting-minutes-pdf";

test("회의록 언어 선택과 관계없이 원문은 모두 포함한다", () => {
  const lines = [
    { kind: "source" as const, lang: "ko" },
    { kind: "source" as const, lang: "vi" },
    { kind: "translation" as const, lang: "ko" },
    { kind: "translation" as const, lang: "th" },
  ].map((line, index) => ({
    ...line,
    messageId: index,
    revision: 0,
    editedAt: null,
    at: index,
    body: String(index),
    speakerName: null,
    text: "",
  }));

  assert.deepEqual(
    selectMinutesLines(lines, ["ko"]).map((line) => [line.kind, line.lang]),
    [["source", "ko"], ["source", "vi"], ["translation", "ko"]],
  );
});

test("같은 원문과 번역을 원문 우선으로 묶는다", () => {
  const lines = [
    { messageId: 1, kind: "translation" as const },
    { messageId: 2, kind: "source" as const },
    { messageId: 1, kind: "source" as const },
  ].map((line, index) => ({
    ...line,
    revision: 0,
    editedAt: null,
    at: index,
    lang: "ko" as const,
    body: String(index),
    speakerName: null,
    text: "",
  }));

  assert.deepEqual(groupMeetingLogLines(lines).map((group) => group.map((line) => line.kind)), [
    ["source", "translation"],
    ["source"],
  ]);
});

test("긴 다국어 회의록은 잘리지 않고 여러 A4 페이지로 이어진다", async () => {
  const pdf = await renderMeetingMinutesPdf({
    meetingTitle: "다국어 세션 회의록 예시",
    languageCodes: ["ko", "vi", "th", "si"],
    displayLanguage: "ko",
    generatedAt: 1_787_683_200_000,
    labels: {
      minutesTitle: "회의록",
      source: "원문",
      translation: "번역",
      generatedAt: "생성 시각",
      edited: "수정됨",
      empty: "표시할 로그가 없습니다",
    },
    lines: [{
      messageId: 1,
      revision: 0,
      editedAt: null,
      at: 1_787_683_200_000,
      lang: "ko",
      kind: "source",
      body: "긴 문장도 페이지 오른쪽에서 잘리지 않고 다음 줄과 다음 페이지로 이어집니다. ".repeat(180),
      speakerName: "진행자",
      text: "",
    }],
  });

  const raw = pdf.toString("latin1");
  assert.ok(raw.startsWith("%PDF-"));
  assert.ok((raw.match(/\/Type \/Page\b/g) ?? []).length >= 2);
  assert.ok(raw.includes("%%EOF"));
});

test("싱할라어 제목과 본문에 내장 Noto 폰트를 사용한다", async () => {
  const pdf = await renderMeetingMinutesPdf({
    meetingTitle: "සිංහල Meeting 0827",
    languageCodes: ["si"],
    displayLanguage: "ko",
    generatedAt: 1_787_683_200_000,
    labels: {
      minutesTitle: "회의록",
      source: "원문",
      translation: "번역",
      generatedAt: "생성 시각",
      edited: "수정됨",
      empty: "표시할 로그가 없습니다",
    },
    lines: [{
      messageId: 1,
      revision: 0,
      editedAt: null,
      at: 1_787_683_200_000,
      lang: "si",
      kind: "source",
      body: "Meeting — ඔයාගේ නම මොකක්ද?",
      speakerName: null,
      text: "",
    }],
  });

  assert.match(pdf.toString("latin1"), /NotoSansSinhala-Regular/);
});
