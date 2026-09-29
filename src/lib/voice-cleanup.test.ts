import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseVoiceAudio, type VoiceAudioResources } from "./voice-cleanup";
import { clientDiagnosticSchema } from "./client-diagnostic-schema";
import { safeFields } from "../../electron/diagnostics.cjs";

test("audio stops synchronously; model initialization/destruction precede context close", async () => {
  const order: string[] = [];
  const loading = Promise.withResolvers<{ destroy: () => Promise<void> }>();
  const destroying = Promise.withResolvers<void>();
  const port = { onmessage: () => {}, close: () => { order.push("port"); } };
  const resources: VoiceAudioResources = {
    stream: { getTracks: () => [{ stop: () => { order.push("track"); } }] },
    processor: { port, disconnect: () => { order.push("node"); } }, nodes: [], vad: loading.promise,
    context: { close: async () => { order.push("context"); } },
  };
  let done = false;
  const cleanup = releaseVoiceAudio(resources, () => {}).then(() => { done = true; });
  assert.equal(port.onmessage, null);
  assert.deepEqual(order, ["port", "track", "node"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  loading.resolve({ destroy: async () => { order.push("vad"); await destroying.promise; } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(order.includes("context"), false);
  destroying.resolve();
  await cleanup;
  assert.deepEqual(order, ["port", "track", "node", "vad", "context"]);
  assert.equal(done, true);
});

test("individual cleanup failures cannot skip the remaining tracks, nodes or context", async () => {
  const events: string[] = [];
  const fail = () => { throw new DOMException("private error with device name", "InvalidStateError"); };
  await releaseVoiceAudio({
    stream: { getTracks: () => [{ stop: fail }, { stop: () => { events.push("other-track"); } }] },
    processor: { port: { onmessage: null, close: fail }, disconnect: fail },
    nodes: [{ disconnect: () => { events.push("other-node"); } }],
    vad: Promise.resolve({ destroy: async () => { fail(); } }),
    context: { close: async () => { events.push("context"); fail(); } },
  }, (phase, fields) => {
    events.push(phase);
    assert.equal(JSON.stringify(fields).includes("private"), false);
  });
  for (const event of ["pcm-detach-failed", "track-stop-failed", "node-disconnect-failed", "vad-destroy-failed",
    "context-close-failed", "other-track", "other-node", "context"]) assert.ok(events.includes(event), event);
});

test("diagnostic contract accepts focus/lifecycle metadata but rejects private/free-text fields", () => {
  const record = { event: "voice", route: "/admin", pageId: "12345678-1234-4234-8234-123456789abc",
    voiceRun: 2, sequence: 12, phase: "start-error-stale", focused: false, activeTag: "BUTTON", disabled: false };
  assert.equal(clientDiagnosticSchema.safeParse(record).success, true);
  assert.equal(clientDiagnosticSchema.safeParse({ ...record, message: "private transcript" }).success, false);
  assert.equal(clientDiagnosticSchema.safeParse({ ...record, phase: "private-transcript" }).success, false);
  assert.equal(clientDiagnosticSchema.safeParse({ ...record, errorType: "private-device-name" }).success, false);
  const saved = safeFields(record);
  assert.equal(saved.voiceRun, 2); assert.equal(saved.focused, false); assert.equal(saved.activeTag, "BUTTON");
  assert.equal(saved.pageId, record.pageId); assert.equal(saved.sequence, 12);
});
