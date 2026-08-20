import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { parseClientMessage, parseServerMessage } from "./realtime/protocol";
import { parseRequiredSqlRow, SqlDataIntegrityError } from "./sqlite-schema";

test("외부 메시지와 SQLite 행을 런타임에서 검증한다", () => {
  const draft = parseClientMessage(JSON.stringify({ t: "draft", text: "x".repeat(5001) }));
  assert.equal(draft?.t, "draft");
  assert.equal(draft?.text.length, 5000);
  assert.equal(parseServerMessage("not-json"), null);

  assert.throws(
    () => parseRequiredSqlRow(z.object({ id: z.number() }), { id: "invalid" }, "테스트 행"),
    (error) => error instanceof SqlDataIntegrityError && error.message.includes("테스트 행"),
  );
});
