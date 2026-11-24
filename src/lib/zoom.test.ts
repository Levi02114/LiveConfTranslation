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
import { connectZoomRtms, firstZoomSocketUrl, verifyZoomWebhook, zoomSocketUrl, type ZoomAudio, type ZoomTranscript } from "./zoom-rtms";
import { pcmRms, upsample16kTo24k } from "./zoom-audio";

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
  const chunks = zoomChatChunks("speaker\nname", [{ lang: "ko", body: "가😀".repeat(1000) }]);
  assert.ok(chunks.every((text) => text.length <= 900 && text.startsWith("speaker name\n")));
  assert.equal(chunks.map((text) => text.slice("speaker name\n".length)).join(""), `[ko] ${"가😀".repeat(1000)}`);
  assert.deepEqual(zoomChatChunks("A", [{ lang: "ko", body: "안녕" }, { lang: "vi", body: "Xin chào" }]), ["A\n[ko] 안녕\n[vi] Xin chào"]);
  assert.equal(firstZoomSocketUrl("https://example.invalid, wss://rtms.zoom.us/signal,wss://b.zoom.us"), "wss://rtms.zoom.us/signal");
  assert.throws(() => firstZoomSocketUrl("wss://evil.test,ws://rtms.zoom.us"));
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
  const { stop } = connectZoomRtms({ clientId: "fake-client-id", clientSecret: "fake-client-secret", meeting: "meeting", stream: "stream",
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
  assert.deepEqual(await stopZoomCapture({ ...sdk, stopRTMS: async () => ({ message: "Failure" }) }, meeting),
    { ok: false, response: "failure", status: "unknown" }, "without a status check a failure stays a warning");
  // 이미 끝난 스트림의 중지 실패는 getRTMSStatus로 멈춘 것이 확인될 때만 정상으로 본다.
  const status = (value: "started" | "stopped" | "paused" | "connecting") => async () => ({ rtmsStatus: [{ rtmsSessionId: "s", displayName: "LCT", status: value, timestamp: 1 }] });
  const alreadyStopped = Object.assign(new Error("RTMS is not running"), { code: "10240" });
  assert.deepEqual(await stopZoomCapture({ ...sdk, stopRTMS: async () => { throw alreadyStopped; }, getRTMSStatus: status("stopped") }, meeting),
    { ok: true, response: "rejected", code: "10240", status: "stopped" });
  assert.deepEqual(await stopZoomCapture({ ...sdk, stopRTMS: async () => ({ message: "Failure" }), getRTMSStatus: async () => ({ rtmsStatus: [] }) }, meeting),
    { ok: true, response: "failure", status: "stopped" });
  for (const running of ["started", "paused", "connecting"] as const) {
    assert.equal((await stopZoomCapture({ ...sdk, stopRTMS: async () => ({ message: "Failure" }), getRTMSStatus: status(running) }, meeting)).ok, false, running);
  }
  assert.deepEqual(await stopZoomCapture({ ...sdk, stopRTMS: async () => { throw new Error("stopRTMS took longer than 10000ms to respond."); },
    getRTMSStatus: async () => { throw new Error("not in capabilities"); } }, meeting), { ok: false, response: "timeout", status: "unknown" });
  // SAFETY: SDK 타입에는 없지만 실제 클라이언트가 소문자로 돌려주는 경우를 흉내 낸다.
  assert.deepEqual(await stopZoomCapture({ ...sdk, stopRTMS: async () => ({ message: "success" as "Success" }) }, meeting), { ok: true, response: "success" });
  const stopsBeforeSwitch = stops;
  assert.deepEqual(await stopZoomCapture({ ...sdk, getMeetingUUID: async () => ({ meetingUUID: "other" }), getRTMSStatus: status("started") }, meeting),
    { ok: true, response: "unbound" }, "another meeting is never stopped or queried");
  assert.equal(stops, stopsBeforeSwitch);
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
    engine: "openai", fallbackEngine: null, targets: ["vi"], audioMode: "transcript", chat: true, consent: true };
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
      engine: "openai", fallbackEngine: null, sourceLang: "ko", targets: ["ko", "vi"], audioMode: "transcript", chat: true, consent: true });
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
    assert.equal(snapshot.received, 1); assert.equal(snapshot.next?.text, "Speaker\n[ko] 안녕하세요\n[vi] Xin chào", "one chat message per utterance");
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
    assert.throws(() => relay.poll(999), /requestFailed/);
    snapshot = relay.poll(delivery.ack);
    assert.equal(snapshot.next, null);
    assert.equal(relay.poll(delivery.ack).sent, 1, "ACK retry is idempotent");
    assert.deepEqual(chats, ["Speaker\n[ko] 안녕하세요\n[vi] Xin chào"], "transcript -> selected translation -> SDK chat, without replay duplicates");
    const archive = repo.getRecentCombined(meeting.id);
    assert.equal(archive.length, 1);
    assert.equal(archive[0].speakerName, "Speaker");
    assert.equal(archive[0].sourceBody, transcript.data);
    assert.deepEqual(archive[0].translations.map(({ lang, body }) => ({ lang, body })), [{ lang: "vi", body: "Xin chào" }]);
    assert.equal(events.filter((event) => event.t === "translation").length, 1, "same saved result is broadcast to viewers");
    assert.equal(calls.length, 1, "chat delivery does not make another paid translation request");
    relay.stop("revoked");
    assert.equal(relay.poll(delivery.ack).next, null);
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
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "c".repeat(32), sourceLang: "vi", targets: ["vi"] }), /sessionSettingsMismatch/);
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "c".repeat(32), sourceLang: "si" }), /invalidLanguage/);
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "c".repeat(32), targets: ["vi", "vi"] }), /invalidLanguage/);
    const expired = zoom.startZoomRelay({ ...input, owner: "c".repeat(32) }); relays.push(expired);
    expired.checkLease(Date.now() + 31000); assert.equal(expired.poll().error, "leaseExpired");
    failTranslation = true;
    const failed = zoom.startZoomRelay({ ...input, owner: "d".repeat(32) }); relays.push(failed);
    failed.receive({ ...transcript, timestamp: 1236, data: "번역 실패에도 원문은 보존합니다" });
    await settle(() => Boolean(failed.poll().next));
    assert.equal(failed.poll().next?.text, "Speaker\n[ko] 번역 실패에도 원문은 보존합니다", "a failed language is skipped, not the relay");
    assert.equal(failed.active, true);
    assert.equal(repo.getRecentMessages(meeting.id).length, 3, "failed translation cannot erase accepted speech");
    failed.stop();
    const quiet = zoom.startZoomRelay({ ...input, owner: "f".repeat(32), chat: false }); relays.push(quiet);
    quiet.receive({ ...transcript, timestamp: 1237, data: "채팅을 끄면 기록만 남습니다" });
    assert.equal(quiet.poll().next, null, "chat toggle off never offers chat messages");
    assert.equal(repo.getRecentMessages(meeting.id).length, 4);
    // 참가자가 입력 화면에서 직접 고른 Zoom 채팅은 운영자 채팅 토글과 별개로 보낸다.
    const { acceptMessage } = await import("./pipeline");
    const typed = acceptMessage({ meeting, pageId: null, lang: "ko", body: "참가자가 고른 채팅입니다", speakerName: "참가자", ingestKey: "typed:zoom-share-test" });
    assert.equal(zoom.shareToZoomChat(typed.message), "queued");
    assert.equal(zoom.shareToZoomChat(typed.message), "queued", "a repeated share never queues the message twice");
    worker.wakeTranslationWorker();
    await settle(() => Boolean(quiet.poll().next));
    const shared = quiet.poll().next!;
    assert.equal(shared.text, "참가자\n[ko] 참가자가 고른 채팅입니다", "same one-message format; the failed language is skipped");
    quiet.poll(shared.sequence);
    assert.equal(quiet.poll().next, null, "acknowledged participant chat is not offered again");
    assert.equal(zoom.shareToZoomChat({ ...typed.message, meetingId: "another-session" }), "unavailable", "another session never reaches this Zoom chat");
    quiet.checkLease(Date.now() + 31000);
    assert.equal(quiet.active, true, "without chat, the panel may be minimized while Zoom audio keeps arriving");
    quiet.stop();
    assert.equal(zoom.shareToZoomChat(typed.message), "unavailable", "stopped relay reports that nothing was sent");
    // 채팅 전송만: RTMS·웹훅 없이 바로 live, 참가자가 고른 입력만 보내고, 앱 창이 사라지면 멈춘다.
    const chatOnly = zoom.startZoomRelay({ ...input, owner: "9".repeat(32), audioMode: "chat", chat: false }); relays.push(chatOnly);
    assert.equal(chatOnly.poll().state, "live", "chat-only never waits for a Zoom stream");
    const fromAudio = acceptMessage({ meeting, pageId: null, lang: "ko", body: "컴퓨터 소리 입력입니다", speakerName: "운영자", ingestKey: "audio:chat-only-test" });
    assert.equal(zoom.shareToZoomChat(fromAudio.message), "queued");
    worker.wakeTranslationWorker();
    await settle(() => Boolean(chatOnly.poll().next));
    assert.equal(chatOnly.poll().next?.text, "운영자\n[ko] 컴퓨터 소리 입력입니다");
    chatOnly.checkLease(Date.now() + 31000);
    assert.equal(chatOnly.poll().error, "leaseExpired", "chat delivery needs the app window");
    repo.closeMeeting(meeting.id);
    assert.throws(() => zoom.startZoomRelay({ ...input, owner: "e".repeat(32) }), /invalidSession/);
    const different = zoom.startZoomRelay({ ...input, owner: "e".repeat(32), zoomMeeting: "different-instance" }); relays.push(different);
    assert.notEqual(different.meeting.id, meeting.id, "the same topic in another Zoom meeting gets a separate archive");
    const { getAdminStrings, sourceEntries } = await import("./i18n-resolver");
    for (const code of ["ko", "vi", "th", "si"]) assert.ok(getAdminStrings(code).zoom.archiveConsent);
    for (const key of ["archiveConsent", "archivePrivacy", "archiveStart", "autoSession", "storageFailed", "viewSession"]) {
      assert.ok(sourceEntries().some((entry) => entry.key === `admin.zoom.${key}`));
    }
    const { getStrings } = await import("./i18n-resolver");
    for (const key of ["label", "off", "voice", "all", "unavailable"]) assert.ok(sourceEntries().some((entry) => entry.key === `ui.zoomChat.${key}`), key);
    for (const code of ["ko", "vi", "th", "si"]) {
      const chat = getStrings(code).zoomChat;
      assert.ok(chat.label && chat.off && chat.voice && chat.all && chat.unavailable, code);
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

test("RTMS audio mode asks for raw per-participant L16, ignores malformed packets and reconnects after a drop", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = z.object({ port: z.number() }).parse(server.address());
  const audio: ZoomAudio[] = [];
  const handshakes: number[] = [];
  let signals = 0;
  server.on("connection", (socket, request) => {
    if (request.url === "/signal") signals++;
    socket.on("message", (raw) => {
      const value = JSON.parse(raw.toString());
      if (value.msg_type === 1) {
        socket.send(JSON.stringify({ msg_type: 2, status_code: 0, media_server: { server_urls: { audio: "wss://rtms.zoom.us/audio", transcript: "wss://rtms.zoom.us/transcript" } } }));
      } else if (value.msg_type === 3) {
        handshakes.push(value.media_type);
        assert.equal(value.payload_encryption, false);
        assert.deepEqual(value.media_params, { audio: { content_type: 2, sample_rate: 1, channel: 1, codec: 1, data_opt: 2, send_rate: 100 } });
        assert.equal(request.url, "/audio");
        socket.send(JSON.stringify({ msg_type: 4, status_code: 0 }));
        socket.send("not json");
        socket.send(JSON.stringify({ msg_type: 14, content: { user_id: "bad" } }));
        socket.send(JSON.stringify({ msg_type: 14, content: { user_id: 7, user_name: "Speaker", timestamp: 1, data: Buffer.from([1, 0, 2, 0]).toString("base64") } }));
        // 첫 연결의 미디어 소켓을 끊어 재연결을 확인한다.
        if (handshakes.length === 1) setTimeout(() => socket.terminate(), 20);
      }
    });
  });
  const ended: string[] = [];
  const rtms = connectZoomRtms({ clientId: "fake-client-id", clientSecret: "fake-client-secret", meeting: "meeting", stream: "stream",
    url: "wss://rtms.zoom.us/signal", audio: { streams: "multi", receive: (value) => audio.push(value) }, state: () => {}, ended: (reason) => ended.push(reason) },
  (url) => new WebSocket(`ws://127.0.0.1:${address.port}${new URL(url).pathname}`));
  try {
    for (let attempt = 0; attempt < 300 && audio.length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(audio.length, 2, "malformed packets are skipped and the dropped stream reconnects");
    assert.deepEqual(audio[0], { userId: 7, userName: "Speaker", pcm: Buffer.from([1, 0, 2, 0]) });
    assert.equal(signals, 2); assert.deepEqual(handshakes, [1, 1]); assert.deepEqual(ended, []);
  } finally {
    rtms.stop(); for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Zoom speaker audio is upsampled, only speech reaches transcription, and each turn is committed once", async () => {
  const sine = (samples: number, amplitude: number) => {
    const pcm = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index++) pcm.writeInt16LE(Math.round(Math.sin(index / 5) * amplitude * 32767), index * 2);
    return pcm;
  };
  assert.equal(upsample16kTo24k(sine(1600, 0.1)).length, 2400 * 2);
  assert.ok(Math.abs(pcmRms(upsample16kTo24k(sine(1600, 0.1))) - pcmRms(sine(1600, 0.1))) < 0.01);

  const directory = mkdtempSync(join(tmpdir(), "lct-zoom-audio-"));
  const previousDatabase = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(directory, "test.db");
  const { getDb } = await import("./db");
  const { ZoomSpeakerStream } = await import("./zoom-audio");
  const sent: string[] = [];
  let bytes = 0;
  let emit: ((event: import("./realtime/internal-transcription").InternalTranscriptionEvent) => void) | undefined;
  const previousBridge = globalThis.__liveConfInternalTranscription;
  globalThis.__liveConfInternalTranscription = (request) => {
    assert.equal(request.streamKey, "zoom:7"); assert.deepEqual(request.languages, ["ko", "vi"]);
    emit = request.onEvent;
    return { start: (value) => sent.push(`start:${value.speakerName}:${value.lang ?? "auto"}`), audio: (pcm) => { bytes += pcm.length; },
      commit: () => sent.push("commit"), heartbeat: () => {}, close: () => sent.push("close") };
  };
  const transcripts: string[] = [];
  const stream = new ZoomSpeakerStream("7", "Speaker", { meetingId: "meeting", languages: () => ["ko", "vi"], language: () => null,
    authorized: () => true, transcript: (_source, event) => transcripts.push(event.body), unavailable: (reason) => sent.push(reason) });
  try {
    let now = 1_000_000;
    for (let frame = 0; frame < 20; frame++) stream.push(Buffer.alloc(3200), now += 100);
    assert.deepEqual(sent, [], "silence never opens a paid transcription session");
    for (let frame = 0; frame < 10; frame++) stream.push(sine(1600, 0.2), now += 100);
    assert.deepEqual(sent, ["start:Speaker:auto"]);
    emit!({ t: "ready" });
    assert.ok(bytes >= 10 * 4800, "queued speech and pre-roll are flushed once ready");
    for (let frame = 0; frame < 30; frame++) stream.push(Buffer.alloc(3200), now += 100);
    assert.deepEqual(sent, ["start:Speaker:auto", "commit"], "one commit per turn");
    const afterTurn = bytes;
    for (let frame = 0; frame < 20; frame++) stream.push(Buffer.alloc(3200), now += 100);
    assert.equal(bytes, afterTurn, "silence after the turn is not streamed");
    emit!({ t: "transcript", itemId: "item", body: "안녕하세요", lang: "ko" });
    assert.deepEqual(transcripts, ["안녕하세요"]);
    // 참가자별 스트림은 조용해지면 패킷이 끊길 수 있다. 프레임이 없어도 타이머가 턴을 끝낸다.
    for (let frame = 0; frame < 10; frame++) stream.push(sine(1600, 0.2), now += 100);
    stream.tick(now + 500);
    assert.equal(sent.filter((item) => item === "commit").length, 1, "no early commit while frames are only briefly late");
    stream.tick(now + 3_000);
    assert.equal(sent.filter((item) => item === "commit").length, 2, "missing frames end the turn once");
    stream.tick(now + 4_000);
    assert.equal(sent.filter((item) => item === "commit").length, 2);
  } finally {
    stream.close();
    globalThis.__liveConfInternalTranscription = previousBridge;
    getDb().close(); globalThis.__meetingDb = undefined;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
