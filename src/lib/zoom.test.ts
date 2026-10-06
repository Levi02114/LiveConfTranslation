import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";
import { setImmediate } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";
import { requestRequiresOrigin } from "./http-security";
import { readZoomMeeting, startZoomCapture, stopZoomCapture, ZoomChatDelivery } from "./zoom-chat";
import { zoomChatChunks, zoomLanguageId, zoomStartSchema } from "./zoom-contract";
import { connectZoomRtms, verifyZoomWebhook, zoomSocketUrl, type ZoomTranscript } from "./zoom-rtms";

test("Zoom verifies raw-body signatures, freshness, exact webhook Origin exemption and safe socket destinations", () => {
  const body = '{"event":"endpoint.url_validation","payload":{"plainToken":"fake-challenge"}}';
  const timestamp = "1790000000", secret = "fake-webhook-secret";
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  assert.equal(verifyZoomWebhook(body, timestamp, signature, secret, Number(timestamp) * 1000), true);
  for (const [value, time, signed, key, now] of [
    [body + " ", timestamp, signature, secret, Number(timestamp) * 1000],
    [body, timestamp, signature, secret, Number(timestamp) * 1000 + 301000],
    [body, timestamp, signature, secret, Number(timestamp) * 1000 - 301000],
    [body, timestamp, signature, "wrong", Number(timestamp) * 1000],
    [body, "NaN", signature, secret, 0], [body, timestamp, "v0=00", secret, 0],
  ] as const) assert.equal(verifyZoomWebhook(value, time, signed, key, now), false);
  assert.equal(requestRequiresOrigin("POST", "/api/zoom/webhook"), false);
  for (const url of ["/api/admin/zoom", "/api/zoom/webhook/", "/api/zoom/webhook?x=1", "/api/zoom/%77ebhook"]) assert.equal(requestRequiresOrigin("POST", url), true);
  assert.equal(requestRequiresOrigin("PUT", "/api/zoom/webhook"), true);
  assert.equal(zoomSocketUrl("wss://rtms.zoom.us/signal"), "wss://rtms.zoom.us/signal");
  for (const url of ["ws://rtms.zoom.us", "wss://127.0.0.1", "wss://zoom.us.evil.test", "wss://rtms.zoom.us:8080", "wss://token@rtms.zoom.us", "wss://rtms.zoom.us/#secret"]) assert.throws(() => zoomSocketUrl(url));
  assert.equal(zoomLanguageId("ko-KR"), 21);
  assert.equal(zoomLanguageId("vi"), 36);
  assert.equal(zoomLanguageId("si"), -1, "Zoom does not advertise Sinhala transcription");
  const chunks = zoomChatChunks("speaker\nname", "ko", "가😀".repeat(1000));
  assert.ok(chunks.every((text) => text.length <= 900 && text.startsWith("[ko] speaker name\n")));
  assert.equal(chunks.map((text) => text.slice("[ko] speaker name\n".length)).join(""), "가😀".repeat(1000));
});

test("RTMS performs both handshakes, keepalives, transcript delivery and explicit stream close", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = z.object({ port: z.number() }).parse(server.address());
  const delivered = Promise.withResolvers<ZoomTranscript>();
  const closed = Promise.withResolvers<void>();
  const keepalives: number[] = [];
  const packet = { user_id: 10, user_name: "Test speaker", timestamp: 42, language: 21, data: "안녕하세요" };
  let signaling: WebSocket | undefined, media: WebSocket | undefined;
  const signature = createHmac("sha256", "fake-client-secret").update("fake-client-id,meeting,stream").digest("hex");
  server.on("connection", (socket, request) => {
    if (request.url === "/signal") signaling = socket; else media = socket;
    socket.on("message", (raw) => {
      const value = JSON.parse(raw.toString());
      if (value.msg_type === 1) {
        assert.equal(value.signature, signature); assert.equal(value.sequence, 1);
        socket.send(JSON.stringify({ msg_type: 2, status_code: 0, media_server: { server_urls: { transcript: "wss://rtms.zoom.us/media" } } }));
      } else if (value.msg_type === 3) {
        assert.equal(value.signature, signature); assert.equal(value.media_type, 8);
        assert.deepEqual(value.media_params, { transcript: { content_type: 5, src_language: 21, enable_lid: true } });
        socket.send(JSON.stringify({ msg_type: 4, status_code: 0 }));
      } else if (value.msg_type === 7) {
        signaling!.send(JSON.stringify({ msg_type: 12, timestamp: 123 }));
        media!.send(JSON.stringify({ msg_type: 12, timestamp: 456 }));
      } else if (value.msg_type === 13) {
        keepalives.push(value.timestamp);
        if (keepalives.length === 2) media!.send(JSON.stringify({ msg_type: 17, content: packet }));
      } else if (value.msg_type === 21) { assert.equal(value.rtms_stream_id, "stream"); closed.resolve(); }
    });
  });
  const states: string[] = [];
  const stop = connectZoomRtms({ clientId: "fake-client-id", clientSecret: "fake-client-secret", meeting: "meeting", stream: "stream",
    url: "wss://rtms.zoom.us/signal", sourceLanguage: 21, transcript: delivered.resolve, state: (value) => states.push(value), ended: (reason) => delivered.reject(new Error(reason)) },
  (url) => new WebSocket(`ws://127.0.0.1:${address.port}${new URL(url).pathname}`));
  try {
    assert.deepEqual(await delivered.promise, packet);
    assert.deepEqual(states, ["live"]); assert.deepEqual(keepalives.sort(), [123, 456]);
    stop(); stop(); await closed.promise;
  } finally {
    stop(); for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Zoom native start cancels late success and never stops a replacement meeting", async () => {
  let meeting = "bound-meeting", starts = 0, stops = 0;
  const began = Promise.withResolvers<void>();
  const response = Promise.withResolvers<{ message: "Success" }>();
  const sdk = {
    getRunningContext: async () => ({ context: "inMeeting" as const }),
    getMeetingUUID: async () => ({ meetingUUID: meeting }),
    startRTMS: async () => { starts++; began.resolve(); return response.promise; },
    stopRTMS: async () => { stops++; return { message: "Success" as const }; },
  };
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(startZoomCapture(sdk, meeting, aborted.signal), { name: "AbortError" });
  assert.equal(starts, 0);
  const controller = new AbortController();
  const pending = startZoomCapture(sdk, meeting, controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await began.promise; controller.abort(); response.resolve({ message: "Success" });
  await rejected;
  assert.equal(starts, 1); assert.equal(stops, 1, "undo native success after the page unmounts");
  await startZoomCapture(sdk, meeting, new AbortController().signal);
  assert.equal(starts, 2); assert.equal(stops, 1, "a successful active start stays running");
  meeting = "replacement-meeting";
  await stopZoomCapture(sdk, "bound-meeting");
  assert.equal(stops, 1, "do not stop an unrelated native RTMS run");
  await assert.rejects(startZoomCapture(sdk, "bound-meeting", new AbortController().signal), /zoomRequired/);
  assert.equal(starts, 2, "meeting mismatch prevents start");
  await assert.rejects(startZoomCapture({ ...sdk, startRTMS: async () => ({ message: "Failure" }) }, meeting, new AbortController().signal), /requestFailed/);
  await assert.rejects(stopZoomCapture({ ...sdk, stopRTMS: async () => ({ message: "Failure" }) }, meeting), /stopFailed/);
  const previousStops = stops;
  await assert.rejects(startZoomCapture({ ...sdk, startRTMS: async () => {
    meeting = "another-meeting"; return { message: "Success" };
  } }, meeting, new AbortController().signal), /zoomRequired/);
  assert.equal(stops, previousStops, "a context switch during native start never stops the new meeting");
});

test("Zoom reads the meeting title without mixing contexts and rejects unconsented archive requests", async () => {
  let uuid = "original";
  const sdk = { getRunningContext: async () => ({ context: "inMeeting" as const }),
    getMeetingUUID: async () => ({ meetingUUID: uuid }),
    getMeetingContext: async () => ({ meetingID: "123", meetingTopic: "  회의 제목  " }) };
  assert.deepEqual(await readZoomMeeting(sdk, "Zoom"), { uuid, title: "회의 제목" });
  assert.equal((await readZoomMeeting({ ...sdk, getMeetingContext: async () => ({ meetingID: "123", meetingTopic: " " }) }, "Zoom")).title, "Zoom");
  await assert.rejects(readZoomMeeting({ ...sdk, getMeetingContext: async () => {
    uuid = "replacement"; return { meetingID: "123", meetingTopic: "wrong" };
  } }, "Zoom"), /zoomRequired/);
  const input = { action: "start", owner: "a".repeat(32), zoomMeeting: uuid, zoomTitle: "Title", sourceLang: "ko",
    engine: "openai", fallbackEngine: null, targets: ["vi"], consent: true };
  assert.ok(zoomStartSchema.safeParse(input).success);
  assert.equal(zoomStartSchema.safeParse({ ...input, consent: false }).success, false);
  assert.equal(zoomStartSchema.safeParse({ ...input, zoomTitle: " " }).success, false);
});

test("Zoom chat stays bound to its meeting and never resends an ambiguous SDK call", async () => {
  let sends = 0;
  const sdk = {
    getRunningContext: async () => ({ context: "inMeeting" as const }),
    getMeetingUUID: async () => ({ meetingUUID: "bound-meeting" }),
    sendMessageToChat: async () => { sends++; return { result: [{ channelId: "channel", messageId: "message" }] }; },
  };
  const next = { sequence: 1, text: "[vi] Speaker\nXin chào" };
  const delivery = new ZoomChatDelivery("bound-meeting", sdk);
  await delivery.deliver(next, () => true); await delivery.deliver(next, () => true);
  assert.equal(sends, 1); assert.equal(delivery.ack, 1);
  await delivery.deliver({ ...next, sequence: 2 }, () => false);
  assert.equal(sends, 1);
  await assert.rejects(new ZoomChatDelivery("different-meeting", sdk).deliver(next, () => true), /sendUncertain/);
  assert.equal(sends, 1, "never sends to another meeting after a context switch");
  const uncertain = new ZoomChatDelivery("bound-meeting", { ...sdk, sendMessageToChat: async () => {
    sends++; throw new Error("SDK reply lost after send");
  } });
  await assert.rejects(uncertain.deliver(next, () => true), /sendUncertain/);
  await assert.rejects(uncertain.deliver(next, () => true), /sendUncertain/);
  assert.equal(sends, 2);
});

test("Zoom auto-creates one durable session, reuses translation jobs, archives through stops and never replays chats", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-zoom-"));
  const previous = { database: process.env.DATABASE_PATH, secret: process.env.SESSION_SECRET };
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.SESSION_SECRET = "fake-zoom-test-session-secret-only";
  const { getDb } = await import("./db");
  const repo = await import("./repo");
  const zoom = await import("./zoom");
  const worker = await import("./translation-worker");
  const hub = await import("./realtime/hub");
  const { encryptSecret, maskSecret } = await import("./crypto");
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  let gate = Promise.withResolvers<void>();
  let failTranslation = false;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/chat\/completions$/);
    const request = z.object({ model: z.string(), messages: z.array(z.object({ content: z.string() })) }).parse(JSON.parse(String(init?.body)));
    assert.equal(request.model, "gpt-6-luna"); calls.push(request.messages[0].content);
    await gate.promise;
    return failTranslation ? Response.json({ error: { message: "fake unauthorized" } }, { status: 401 })
      : Response.json({ choices: [{ message: { content: "Xin chào" } }] });
  };
  async function settle(check: () => boolean) {
    for (let attempt = 0; attempt < 100 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(check(), "local fake translation should settle");
  }
  const relays: InstanceType<typeof zoom.ZoomRelay>[] = [];
  const events: import("./realtime/protocol").ServerMessage[] = [];
  let viewer: import("./realtime/hub").Connection | undefined;
  try {
    zoom.saveZoomCredentials({ clientId: "fake-client", clientSecret: "fake-secret", webhookSecret: "fake-webhook" });
    assert.ok(!repo.getZoomSettings()!.includes("fake-secret"));
    assert.equal(zoom.zoomSettingsStatus().hasClientSecret, true);
    assert.ok(!JSON.stringify(zoom.zoomSettingsStatus()).includes("fake-secret"));
    zoom.saveZoomCredentials({ clientId: "fake-client", clientSecret: "", webhookSecret: "" });
    assert.equal(zoom.readZoomCredentials()?.webhookSecret, "fake-webhook");
    assert.throws(() => zoom.saveZoomCredentials({ clientId: "other", clientSecret: "", webhookSecret: "" }), /notConfigured/);
    repo.upsertEngineSecret({ engine: "openai", secret: encryptSecret("fake-openai-key"), hint: maskSecret("fake-openai-key") });
    const input = zoomStartSchema.parse({ action: "start", owner: "a".repeat(32), zoomMeeting: "zoom-meeting", zoomTitle: "회의에서 가져온 이름",
      engine: "openai", fallbackEngine: null, sourceLang: "ko", targets: ["ko", "vi"], consent: true });
    const relay = zoom.startZoomRelay(input);
    relays.push(relay);
    const meeting = relay.meeting;
    assert.equal(meeting.title, input.zoomTitle);
    assert.equal(meeting.fallbackEngine, null, "no implicit online fallback");
    assert.equal(zoom.startZoomRelay(input), relay);
    assert.equal(repo.listMeetings().length, 1);
    assert.deepEqual(repo.getMeetingActiveLangs(meeting.id), input.targets);
    assert.ok(relay.poll().session.viewerPath.startsWith("/all/"));
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "b".repeat(32) }), /busy/);
    assert.throws(() => zoom.ownedZoomRelay("b".repeat(32)), /requestFailed/);
    viewer = { clientId: "test-viewer", meetingId: meeting.id, kind: "combined", lang: null,
      name: "", nameClaimed: false, draft: "", send: (event) => events.push(event) };
    hub.join(viewer);
    worker.startTranslationWorker();
    const transcript = { user_id: 1, user_name: "Speaker", timestamp: 1234, language: 21, data: "안녕하세요" };
    relay.receive(transcript); relay.receive(transcript); await setImmediate();
    assert.equal(calls.length, 1, "only vi is translated; ko is the source");
    assert.equal(repo.getRecentMessages(meeting.id).length, 1, "source is durable before translation completes");
    assert.equal(events.filter((event) => event.t === "message").length, 1, "source is broadcast once");
    assert.equal(relay.poll().next, null, "wait for the shared durable worker, never translate twice");
    gate.resolve(); await settle(() => Boolean(relay.poll().next));
    let snapshot = relay.poll();
    assert.equal(snapshot.received, 1); assert.equal(snapshot.next?.text, "[ko] Speaker\n안녕하세요");
    assert.deepEqual(relay.poll().next, snapshot.next, "lost delivery response returns the same item");
    const chats: string[] = [];
    const delivery = new ZoomChatDelivery(input.zoomMeeting, {
      getRunningContext: async () => ({ context: "inMeeting" as const }),
      getMeetingUUID: async () => ({ meetingUUID: input.zoomMeeting }),
      sendMessageToChat: async ({ message }) => {
        chats.push(message);
        return { result: [{ channelId: "test-channel", messageId: String(chats.length) }] };
      },
    });
    await delivery.deliver(snapshot.next!, () => relay.active);
    await delivery.deliver(relay.poll().next!, () => relay.active);
    assert.throws(() => relay.poll(999), /requestFailed/);
    const ack = delivery.ack;
    snapshot = relay.poll(ack);
    assert.equal(snapshot.next?.text, "[vi] Speaker\nXin chào");
    assert.deepEqual(relay.poll(ack).next, snapshot.next, "ACK retry cannot discard the next message");
    assert.equal(snapshot.sent, 1);
    await delivery.deliver(snapshot.next!, () => relay.active);
    assert.equal(relay.poll(delivery.ack).sent, 2);
    assert.deepEqual(chats, ["[ko] Speaker\n안녕하세요", "[vi] Speaker\nXin chào"], "transcript -> selected translation -> SDK chat, without replay duplicates");
    const archive = repo.getRecentCombined(meeting.id);
    assert.equal(archive.length, 1);
    assert.equal(archive[0].speakerName, "Speaker");
    assert.equal(archive[0].sourceBody, transcript.data);
    assert.deepEqual(archive[0].translations.map(({ lang, body }) => ({ lang, body })), [{ lang: "vi", body: "Xin chào" }]);
    assert.equal(events.filter((event) => event.t === "translation").length, 1, "same saved result is broadcast to viewers");
    assert.equal(calls.length, 1, "chat delivery does not make another paid translation request");
    relay.stop("revoked");
    assert.equal(relay.poll(snapshot.next!.sequence).next, null);
    assert.equal(relay.poll().pending, 0); assert.equal(relay.poll().error, "revoked");
    assert.equal(zoom.startZoomRelay(input).active, false, "late start retries do not resurrect a stopped run");
    worker.stopTranslationWorker(); await setImmediate();
    getDb().close(); globalThis.__meetingDb = undefined; globalThis.__zoomRelay = undefined;
    const again = zoom.startZoomRelay({ ...input, owner: "b".repeat(32), zoomTitle: "Changed Zoom title" }); relays.push(again);
    assert.equal(again.meeting.id, meeting.id, "DB reopen keeps the meeting binding");
    assert.equal(again.meeting.title, input.zoomTitle, "reconnect preserves the archive title");
    assert.equal(repo.listMeetings().length, 1);
    worker.startTranslationWorker();
    again.receive(transcript);
    assert.equal(again.poll().next, null, "replayed speech never resends an old chat");
    assert.equal(repo.getRecentMessages(meeting.id).length, 1, "durable ingest key deduplicates across reconnect");
    gate = Promise.withResolvers<void>();
    again.receive({ ...transcript, timestamp: 1235, data: "다음 발언입니다" });
    assert.equal(repo.getRecentMessages(meeting.id).length, 2);
    again.stop(); gate.resolve();
    await settle(() => repo.getRecentCombined(meeting.id)[1]?.translations.length === 1);
    assert.equal(again.poll().next, null, "stopped chat never sends late results, while the archive finishes translating");
    assert.equal(calls.length, 2);
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "c".repeat(32), targets: ["vi"] }), /sessionSettingsMismatch/);
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "c".repeat(32), sourceLang: "si" }), /invalidLanguage/);
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "c".repeat(32), targets: ["vi", "vi"] }), /invalidLanguage/);
    const expired = zoom.startZoomRelay({ ...input, owner: "c".repeat(32) }); relays.push(expired);
    expired.checkLease(Date.now() + 31000); assert.equal(expired.poll().error, "leaseExpired");
    failTranslation = true;
    const failed = zoom.startZoomRelay({ ...input, owner: "d".repeat(32) }); relays.push(failed);
    failed.receive({ ...transcript, timestamp: 1236, data: "번역 실패에도 원문은 보존합니다" });
    await settle(() => failed.poll().state === "error");
    assert.equal(failed.poll().error, "translationFailed");
    assert.equal(repo.getRecentMessages(meeting.id).length, 3, "failed translation cannot erase accepted speech");
    repo.closeMeeting(meeting.id);
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "e".repeat(32) }), /invalidSession/);
    const different = zoom.startZoomRelay({ ...input, owner: "e".repeat(32), zoomMeeting: "different-instance" }); relays.push(different);
    assert.notEqual(different.meeting.id, meeting.id, "the same topic in another Zoom meeting gets a separate archive");
    const { getAdminStrings, sourceEntries } = await import("./i18n-resolver");
    for (const code of ["ko", "vi", "th", "si"]) assert.ok(getAdminStrings(code).zoom.archiveConsent);
    for (const key of ["archiveConsent", "archivePrivacy", "archiveStart", "autoSession", "storageFailed", "viewSession"]) {
      assert.ok(sourceEntries().some((entry) => entry.key === `admin.zoom.${key}`));
    }
    repo.upsertUiStrings("vi", [{ key: "admin.zoom.archiveStart", text: "manual-zoom-label", origin: "manual" }]);
    assert.equal(getAdminStrings("vi").zoom.archiveStart, "manual-zoom-label");
  } finally {
    gate.resolve(); worker.stopTranslationWorker(); await setImmediate(); globalThis.fetch = previousFetch;
    if (viewer) hub.leave(viewer);
    for (const relay of relays) relay.stop(); globalThis.__zoomRelay = undefined;
    getDb().close(); globalThis.__meetingDb = undefined;
    if (previous.database === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous.database;
    if (previous.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous.secret;
    rmSync(directory, { recursive: true, force: true });
  }
});
