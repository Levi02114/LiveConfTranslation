import assert from "node:assert/strict";
import test from "node:test";

import { postPageMessage, queueAfter } from "./use-submit-queue";

test("느린 전송 중에도 추가한 문장을 순서대로 처리한다", async () => {
  const sent: string[] = [];
  let tail = Promise.resolve();

  tail = queueAfter(tail, async () => { sent.push("첫 문장"); });
  tail = queueAfter(tail, async () => { sent.push("둘째 문장"); });
  tail = queueAfter(tail, async () => { sent.push("셋째 문장"); });

  await tail;
  assert.deepEqual(sent, ["첫 문장", "둘째 문장", "셋째 문장"]);
});

test("불안정한 회선에서 같은 키로 재시도한다", async () => {
  const bodies: string[] = [];
  let attempts = 0;
  const response = await postPageMessage(
    "input-token",
    { body: "안녕하세요", ingestKey: "typed:fixed-request" },
    {
      delays: [0, 0, 0],
      timeoutMs: 100,
      fetcher: async (_input, init) => {
        bodies.push(String(init?.body));
        attempts += 1;
        if (attempts === 1) throw new TypeError("network disconnected");
        return new Response(null, { status: attempts === 2 ? 503 : 201 });
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(attempts, 3);
  assert.equal(new Set(bodies).size, 1);
});
