/**
 * 커스텀 Node 서버.
 *
 * Next.js 라우트 핸들러만으로는 WebSocket 업그레이드를 받을 수 없다. 입력 페이지의
 * 다중 속기사 동기화가 양방향이라 WebSocket 이 필요하고, 그래서 HTTP 서버를 직접
 * 띄워 Next 를 그 위에 얹는다. 자체 호스팅 전용이라 제약이 없다.
 *
 * 실행: `npm run dev` / `npm start` (둘 다 이 파일을 tsx 로 띄운다)
 *
 * ─ 모듈 인스턴스에 대하여 ─
 * Next 가 번들한 라우트 핸들러와 이 파일은 같은 `src/lib/*` 를 각각 따로 평가한다.
 * 그래서 허브 상태는 `globalThis` 에 둔다(`src/lib/realtime/hub.ts`). 같은 프로세스라
 * 양쪽이 같은 객체를 본다.
 */

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

import next from "next";
import { WebSocket as WsSocket, WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

import { isAdminFromCookieHeader } from "@/lib/auth-core";
import { matchDetectedLanguage } from "@/lib/detected-language";
import { openaiRealtimeTranscribeUrl } from "@/lib/env";
import { hasScriptEvidence, scriptLanguageOf } from "@/lib/script-language";
import type { LanguageCode } from "@/lib/languages";
import {
  broadcastPresence,
  claimInputName,
  type Connection,
  join,
  leave,
} from "@/lib/realtime/hub";
import { parseClientMessage, type ServerMessage } from "@/lib/realtime/protocol";
import {
  getMeeting,
  getMeetingLanguageConfigs,
  getPageByToken,
  isPageEnabled,
  listMeetings,
  type Meeting,
  type Page,
} from "@/lib/repo";
import {
  claimCapture,
  claimExclusiveCapture,
  releaseCapture,
  renewCapture,
} from "@/lib/realtime/capture-lease";
import { engineKey } from "@/lib/secrets";
import {
  buildCombinedSessionParams,
  buildSingleSessionParams,
  splitTranscribeHintLangs,
} from "@/lib/transcribe-config";
import { singleTranscriptionProfile } from "@/lib/transcription-profile";
import { RescueAudioTurns, RESCUE_MAX_BYTES, rescueTranscribe } from "@/lib/transcription-rescue";

declare global {
  var __liveConfTranslationAppRoot: string | undefined;
}

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
// 0.0.0.0 으로 열어야 같은 네트워크의 참석자 기기에서 접속할 수 있다.
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const appRoot = globalThis.__liveConfTranslationAppRoot ?? process.cwd();

const app = next({ dev, hostname, port, dir: appRoot });
const handle = app.getRequestHandler();

/** 이름을 안 준 속기사에게 붙일 순번. 사람이 서로를 구분할 수 있으면 충분하다. */
let anonymousCounter = 0;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    res.end(
      JSON.stringify({
        service: "live-conf-translation",
        openMeetings: listMeetings().filter((meeting) => meeting.status === "open").length,
      }),
    );
    return;
  }

  handle(req, res).catch((error) => {
    console.error("[http] 요청 처리 실패", error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  });
});

const wss = new WebSocketServer({ noServer: true });
const transcriptionWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/ws/transcribe") {
    const target = resolveTranscriptionTarget(url);
    if (!target) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    transcriptionWss.handleUpgrade(request, socket, head, (ws) => {
      attachTranscription(ws, target);
    });
    return;
  }

  if (url.pathname !== "/ws") {
    // Next 의 HMR 소켓 등 다른 업그레이드는 건드리지 않는다.
    return;
  }

  const resolved = resolveConnectionTarget(url, request.headers.cookie);
  if (!resolved) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    attach(ws, resolved);
  });
});

type Target = {
  meetingId: string;
  kind: Connection["kind"];
  lang: LanguageCode | null;
};

/**
 * 업그레이드 요청이 어느 회의의 무엇으로 붙으려는지 판정한다.
 *
 * 페이지는 URL 토큰으로, 대시보드는 관리자 쿠키로 인증한다.
 * 판정할 수 없으면 `null` 을 돌려 연결을 거절한다.
 */
function resolveConnectionTarget(url: URL, cookie: string | undefined): Target | null {
  const meetingId = url.searchParams.get("meeting");
  if (meetingId) {
    // 대시보드: 관리자만 회의 전체를 볼 수 있다.
    if (!isAdminFromCookieHeader(cookie)) return null;
    if (!getMeeting(meetingId)) return null;
    return { meetingId, kind: "dashboard", lang: null };
  }

  const token = url.searchParams.get("token");
  if (!token) return null;

  const page = getPageByToken(token);
  if (!page || !isPageEnabled(page)) return null;
  if (!getMeeting(page.meetingId)) return null;

  return { meetingId: page.meetingId, kind: page.kind, lang: page.lang };
}

type TranscriptionTarget = {
  page: Page & { lang: LanguageCode };
  meeting: Meeting;
  clientId: string;
  languages: LanguageCode[];
  mode: "single" | "combined";
};

function resolveTranscriptionTarget(url: URL): TranscriptionTarget | null {
  const token = url.searchParams.get("token");
  const clientId = url.searchParams.get("clientId")?.slice(0, 100);
  if (!token || !clientId || clientId.length < 8) return null;
  const page = getPageByToken(token);
  const lang = page?.lang;
  if (!page || !lang || !isPageEnabled(page)) return null;
  const meeting = getMeeting(page.meetingId);
  if (!meeting || meeting.status !== "open") return null;
  if (page.kind === "combined-input") {
    const languages = getMeetingLanguageConfigs(meeting.id)
      .filter((row) => row.inputEnabled)
      .map((row) => row.lang);
    return {
      page: { ...page, lang },
      meeting,
      clientId,
      languages,
      mode: "combined",
    };
  }
  if (
    (page.kind !== "input" && page.kind !== "capture") ||
    singleTranscriptionProfile(lang).transport !== "websocket" ||
    (page.kind === "capture" && meeting.inputMode !== "realtime")
  ) return null;
  return {
    page: { ...page, lang },
    meeting,
    clientId,
    languages: [lang],
    mode: "single",
  };
}

const openAiTranscriptionEventSchema = z.object({
  type: z.string().optional(),
  item_id: z.string().optional(),
  content_index: z.number().optional(),
  delta: z.string().optional(),
  transcript: z.string().optional(),
  languages: z.array(z.object({ code: z.string().optional() })).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
type OpenAiTranscriptionEvent = z.infer<typeof openAiTranscriptionEventSchema>;

const transcriptionClientMessageSchema = z.union([
  z.object({ t: z.literal("start"), speakerName: z.string().optional() }),
  z.object({ t: z.literal("heartbeat") }),
  z.object({ t: z.literal("commit") }),
]);

type TranscriptionServerMessage =
  | { t: "error"; reason: "busy" | "key-required" | "speaker-required" | "lost" }
  | { t: "ready"; leaseId: string | null }
  | { t: "partial"; text: string }
  | {
      t: "transcript";
      itemId: string;
      contentIndex: number;
      body: string;
      lang: LanguageCode;
      usedFallback: boolean;
      leaseId: string | null;
    };

type OpenAiTranscriptionSettings = {
  model: string;
  languages?: string[];
  keywords: string[];
  delay?: "minimal" | "low" | "medium" | "high" | "xhigh";
  prompt: string;
};

function attachTranscription(ws: WebSocket, target: TranscriptionTarget) {
  let upstream: WsSocket | null = null;
  let leaseId: string | null = null;
  let speakerName: string | null = null;
  let started = false;
  let closed = false;
  const committed: string[] = [];
  const completedEvents = new Map<string, OpenAiTranscriptionEvent>();
  const partials = new Map<string, string>();
  let nextTranscript = 0;
  let draining = false;

  // 2차 전사(rescue)는 힌트 미지원 언어가 있는 세션에서만 의미가 있다 —
  // 그런 언어가 없으면 문자 교차 검증으로 충분하므로 PCM 을 쌓지 않는다.
  const rescueEnabled =
    target.mode === "combined" &&
    splitTranscribeHintLangs(target.languages).unsupported.length > 0;
  let sessionKey: string | null = null;
  let rescuePrompt = "";
  const rescueAudio = rescueEnabled ? new RescueAudioTurns() : null;

  const send = (message: TranscriptionServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (leaseId) releaseCapture(target.page.id, leaseId);
    upstream?.close();
    upstream = null;
  };
  const fail = (reason: "busy" | "key-required" | "speaker-required" | "lost") => {
    send({ t: "error", reason });
    ws.close(1011, reason);
  };
  const handleCompleted = async (itemId: string, event: OpenAiTranscriptionEvent) => {
    let body = event.transcript?.trim() ?? "";
    let lang = target.page.lang;
    let usedFallback = false;
    let scripted: LanguageCode | null = null;
    let detected: LanguageCode | null = null;
    if (target.mode === "combined") {
      detected = matchDetectedLanguage(event.languages?.[0]?.code, target.languages);
      // 문자 증거가 모델 감지와 다르면 문자를 우선한다 — 한글·태국어·싱할라
      // 문자 영역은 짧은 발화에서도 흔들리지 않는다.
      scripted = scriptLanguageOf(body, target.languages);
      lang = scripted ?? detected ?? target.page.lang;
      usedFallback = !scripted && !detected;
    }

    // item_id 에 커밋 시점의 경계를 먼저 결합해 두었으므로 완료 순서가 뒤집혀도
    // 다른 턴의 PCM 을 rescue 에 보내지 않는다.
    const turnPcm = rescueAudio?.take(itemId) ?? null;

    // 문자·감지 증거가 모두 없거나(폴백) 둘이 충돌하는 턴은 배치로 한 번 더 듣는다.
    // 충돌 예: 문자는 싱할라인데 감지는 bn/ta — 실측에서 이 경우 절반은 깨진 문자열이었다.
    // 세 번째 경우: 감지는 한국어인데 문자에 한글이 한 글자도 없는 경우처럼, 감지 결과를
    // 문자가 뒷받침하지 못하는 턴(실측에서 Thaana 음역을 ko 로 저장하는 사고가 있었다).
    const rawDetected = event.languages?.[0]?.code?.toLowerCase().split("-")[0] ?? null;
    const conflict = Boolean(
      scripted && rawDetected && rawDetected !== scripted.toLowerCase().split("-")[0],
    );
    const contradicted = Boolean(
      !scripted && detected && hasScriptEvidence(body, detected) === false,
    );
    if ((usedFallback || conflict || contradicted) && rescueEnabled && sessionKey) {
      if (turnPcm && turnPcm.byteLength <= RESCUE_MAX_BYTES) {
        const rescued = await rescueTranscribe({ pcm: turnPcm, key: sessionKey, prompt: rescuePrompt });
        let rescueStatus = "failed";
        if (rescued) {
          // 배치 결과는 문자 증거가 세션 언어를 가리킬 때만 받아들인다.
          const rescuedLang = scriptLanguageOf(rescued, target.languages);
          if (rescuedLang) {
            body = rescued;
            lang = rescuedLang;
            usedFallback = false;
            rescueStatus = "accepted";
          } else {
            rescueStatus = "rejected-script";
          }
        }
        console.warn(
          `[rescue] item=${itemId} duration=${(turnPcm.byteLength / 48_000).toFixed(1)}s status=${rescueStatus}`,
        );
      } else {
        console.warn(`[rescue] item=${itemId} status=skipped-audio`);
      }
    }

    if (body) {
      send({
        t: "transcript",
        itemId,
        contentIndex: event.content_index ?? 0,
        body,
        lang,
        usedFallback,
        leaseId,
      });
    }
  };

  const drainCompleted = async () => {
    if (draining) return;
    draining = true;
    try {
      while (nextTranscript < committed.length) {
        const itemId = committed[nextTranscript];
        const event = completedEvents.get(itemId);
        if (!event) break;
        nextTranscript += 1;
        completedEvents.delete(itemId);
        await handleCompleted(itemId, event);
      }
    } finally {
      draining = false;
      if (
        nextTranscript < committed.length &&
        completedEvents.has(committed[nextTranscript])
      ) void drainCompleted();
    }
  };

  const start = () => {
    const key = engineKey("openai");
    if (!key) {
      fail("key-required");
      return;
    }
    const lease = target.mode === "combined"
      ? claimExclusiveCapture(target.meeting.id, target.page.id, target.clientId)
      : claimCapture(target.meeting.id, target.page.id, target.clientId);
    if (!lease) {
      fail("busy");
      return;
    }
    leaseId = lease.leaseId;
    sessionKey = key;
    const params = target.mode === "combined"
      ? buildCombinedSessionParams(
          target.languages,
          target.page.lang,
          target.meeting.title,
          { context: target.meeting.transcriptionContext, speaker: speakerName },
        )
      : buildSingleSessionParams(target.page.lang, target.meeting.title, {
          farField: target.page.kind === "capture",
          context: target.meeting.transcriptionContext,
          speaker: speakerName,
        });
    if (rescueEnabled) {
      rescuePrompt = params.prompt +
        (params.keywords.length ? ` Terminology: ${params.keywords.join(", ")}.` : "");
    }

    // 전사 세션은 모델명이 아니라 intent=transcription 으로 연다.
    // ?model=gpt-transcribe 는 현재 API 가 거부한다(전사 모델은 세션 모델이 될 수 없다).
    upstream = new WsSocket(openaiRealtimeTranscribeUrl(), {
      headers: {
        authorization: `Bearer ${key}`,
        "OpenAI-Safety-Identifier": createHash("sha256")
          .update(target.page.id)
          .digest("hex"),
      },
    });
    upstream.on("open", () => {
      const transcription: OpenAiTranscriptionSettings = {
        model: params.model,
        keywords: params.keywords,
        prompt: params.prompt,
      };
      if (params.languages.length) transcription.languages = params.languages;
      if (params.delay) transcription.delay = params.delay;
      upstream?.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              noise_reduction: { type: params.noiseReduction },
              transcription,
              turn_detection: null,
            },
          },
        },
      }));
    });
    upstream.on("message", (raw) => {
      let value;
      try {
        value = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = openAiTranscriptionEventSchema.safeParse(value);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === "session.updated" || event.type === "transcription_session.updated") {
        send({ t: "ready", leaseId });
        return;
      }
      if (event.type === "input_audio_buffer.committed" && event.item_id) {
        committed.push(event.item_id);
        rescueAudio?.bindCommit(event.item_id);
        void drainCompleted();
        return;
      }
      if (!event.item_id) {
        if (event.type === "error") fail("lost");
        return;
      }
      if (event.type === "conversation.item.input_audio_transcription.delta") {
        partials.set(event.item_id, (partials.get(event.item_id) ?? "") + (event.delta ?? ""));
        send({ t: "partial", text: [...partials.values()].join(" ") });
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        partials.delete(event.item_id);
        send({ t: "partial", text: [...partials.values()].join(" ") });
        completedEvents.set(event.item_id, event);
        void drainCompleted();
      }
    });
    upstream.on("close", () => {
      if (!closed) fail("lost");
    });
    upstream.on("error", () => {
      if (!closed) fail("lost");
    });
  };

  ws.on("message", (raw, binary) => {
    if (binary) {
      if (!started || !upstream || upstream.readyState !== WsSocket.OPEN) return;
      const audio = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw);
      if (audio.byteLength > 256 * 1024) {
        ws.close(1009, "Audio frame too large");
        return;
      }
      // 2차 전사(rescue)용으로 원시 PCM 을 세션 동안만 보관한다.
      rescueAudio?.append(audio);
      upstream.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audio.toString("base64"),
      }));
      return;
    }

    let value;
    try {
      value = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const parsed = transcriptionClientMessageSchema.safeParse(value);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.t === "start" && !started) {
      speakerName = message.speakerName?.trim().slice(0, 40) || null;
      if (target.page.kind !== "capture" && target.meeting.speakerLabels && !speakerName) {
        fail("speaker-required");
        return;
      }
      started = true;
      start();
    } else if (message.t === "heartbeat" && leaseId) {
      if (!renewCapture(target.page.id, leaseId)) fail("lost");
    } else if (message.t === "commit" && upstream?.readyState === WsSocket.OPEN) {
      rescueAudio?.markCommit();
      upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
  });
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

function attach(ws: WebSocket, target: Target) {
  const clientId = randomUUID();

  // 이름은 입력 페이지에서만 쓰인다(서로를 구분해야 하므로). 보기 전용 연결에는
  // 번호를 붙이지 않는다 — 참석자에게 "입력자 3" 이라는 이름이 생기면 혼란스럽다.
  const name =
    target.kind === "input" || target.kind === "combined-input"
      ? `#${(anonymousCounter += 1)}`
      : "";

  const connection: Connection = {
    clientId,
    meetingId: target.meetingId,
    kind: target.kind,
    lang: target.lang,
    name,
    nameClaimed: false,
    draft: "",
    send: (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
    close: () => ws.close(1008, "Page disabled"),
  };

  join(connection);
  connection.send({ t: "hello", clientId, name: connection.name });

  if ((connection.kind === "input" || connection.kind === "combined-input") && connection.lang) {
    broadcastPresence(connection.meetingId, connection.lang, connection.kind);
  }

  ws.on("message", (raw) => {
    const message = parseClientMessage(raw.toString());
    if (!message) return;

    // 초안과 이름은 입력 페이지에서만 의미가 있다.
    if (
      (connection.kind !== "input" && connection.kind !== "combined-input") ||
      !connection.lang
    ) return;

    if (message.t === "draft") connection.draft = message.text;
    if (message.t === "name") {
      const claimed = claimInputName(connection, message.name);
      connection.send(
        claimed
          ? { t: "name-result", ok: true, name: connection.name }
          : { t: "name-result", ok: false, reason: "duplicate" },
      );
    }

    broadcastPresence(connection.meetingId, connection.lang, connection.kind);
  });

  const cleanup = () => {
    leave(connection);
    if ((connection.kind === "input" || connection.kind === "combined-input") && connection.lang) {
      broadcastPresence(connection.meetingId, connection.lang, connection.kind);
    }
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

/**
 * 최상위 await 대신 함수로 감싼다 — tsx 는 이 파일을 CJS 로 변환하는데
 * CJS 출력은 최상위 await 를 지원하지 않는다.
 */
async function main() {
  await app.prepare();

  server.listen(port, hostname, () => {
    console.log(`▲ 실시간 세션 번역 서버: http://${hostname}:${port}`);
    if (dev) console.log("  개발 모드");
  });
}

main().catch((error) => {
  console.error("[server] 기동 실패", error);
  process.exit(1);
});
