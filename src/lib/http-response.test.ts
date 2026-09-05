import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { compressedTextResponse } from "./http-response";

test("경량 응답을 gzip으로 전송한다", async () => {
  const body = "실시간 번역 ".repeat(300);
  const response = compressedTextResponse(
    new Request("http://localhost/out/token", { headers: { "accept-encoding": "gzip" } }),
    body,
  );

  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.equal(gunzipSync(Buffer.from(await response.arrayBuffer())).toString(), body);
});
