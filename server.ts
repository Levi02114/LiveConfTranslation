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

import { isAdminFromCookieHeader } from "@/lib/auth-core";
import { matchDetectedLanguage } from "@/lib/detected-language";
import { openaiRealtimeWebSocketUrl } from "@/lib/env";
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
  listGlossaryEntries,
  listMeetings,
  type Meeting,
  type Page,
} from "@/lib/repo";
import {
  claimExclusiveCapture,
  releaseCapture,
  renewCapture,
} from "@/lib/realtime/capture-lease";
import { engineKey } from "@/lib/secrets";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
// 0.0.0.0 으로 열어야 같은 네트워크의 참석자 기기에서 접속할 수 있다.
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const appRoot =
  (
    globalThis as typeof globalThis & {
      __liveConfTranslationAppRoot?: string;
    }
  ).__liveConfTranslationAppRoot ?? process.cwd();

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

  handle(req, res).catch((error: unknown) => {
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
    const target = resolveCombinedInputTarget(url);
    if (!target) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    transcriptionWss.handleUpgrade(request, socket, head, (ws) => {
      attachCombinedTranscription(ws, target);
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

type CombinedInputTarget = {
  page: Page & { lang: LanguageCode };
  meeting: Meeting;
  clientId: string;
  languages: LanguageCode[];
};

function resolveCombinedInputTarget(url: URL): CombinedInputTarget | null {
  const token = url.searchParams.get("token");
  const clientId = url.searchParams.get("clientId")?.slice(0, 100);
  if (!token || !clientId || clientId.length < 8) return null;
  const page = getPageByToken(token);
  if (!page || page.kind !== "combined-input" || !page.lang || !isPageEnabled(page)) return null;
  const meeting = getMeeting(page.meetingId);
  if (!meeting || meeting.status !== "open") return null;
  const languages = getMeetingLanguageConfigs(meeting.id)
    .filter((row) => row.inputEnabled)
    .map((row) => row.lang);
  return { page: page as Page & { lang: LanguageCode }, meeting, clientId, languages };
}

type OpenAiTranscriptionEvent = {
  type?: string;
  item_id?: string;
  content_index?: number;
  delta?: string;
  transcript?: string;
  languages?: { code?: string }[];
  error?: { message?: string };
};

function attachCombinedTranscription(ws: WebSocket, target: CombinedInputTarget) {
  let upstream: WsSocket | null = null;
  let leaseId: string | null = null;
  let speakerName: string | null = null;
  let started = false;
  let closed = false;
  const committed: string[] = [];
  const completed = new Map<
    string,
    { contentIndex: number; body: string; lang: LanguageCode; usedFallback: boolean }
  >();
  const partials = new Map<string, string>();
  let nextTranscript = 0;

  const send = (message: unknown) => {
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
  const flush = () => {
    while (nextTranscript < committed.length) {
      const itemId = committed[nextTranscript];
      const item = completed.get(itemId);
      if (!item) break;
      nextTranscript += 1;
      completed.delete(itemId);
      if (item.body) {
        send({
          t: "transcript",
          itemId,
          contentIndex: item.contentIndex,
          body: item.body,
          lang: item.lang,
          usedFallback: item.usedFallback,
          leaseId,
        });
      }
    }
  };

  const start = () => {
    const key = engineKey("openai");
    if (!key) {
      fail("key-required");
      return;
    }
    const lease = claimExclusiveCapture(
      target.meeting.id,
      target.page.id,
      target.clientId,
    );
    if (!lease) {
      fail("busy");
      return;
    }
    leaseId = lease.leaseId;

    const terms = listGlossaryEntries()
      .flatMap((entry) => Object.values(entry.terms))
      .map((term) => term.trim())
      .filter((term, index, rows) => term && !/[\r\n<>]/.test(term) && rows.indexOf(term) === index)
      .slice(0, 100);
    const title = target.meeting.title.replace(/\s+/g, " ").trim().slice(0, 160);

    upstream = new WsSocket(openaiRealtimeWebSocketUrl("gpt-transcribe"), {
      headers: {
        authorization: `Bearer ${key}`,
        "OpenAI-Safety-Identifier": createHash("sha256")
          .update(target.page.id)
          .digest("hex"),
      },
    });
    upstream.on("open", () => {
      upstream?.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              noise_reduction: { type: "near_field" },
              transcription: {
                model: "gpt-transcribe",
                languages: target.languages.map((lang) => lang.toLowerCase()),
                keywords: terms,
                prompt: `Live session title/context: "${title}". Transcribe every intelligible word exactly as spoken. Detect the spoken language from the allowed language list. Preserve names, numbers, short acknowledgements, and glossary terms. Never translate, summarize, answer, invent speaker labels, or add unspoken text.`,
              },
              turn_detection: null,
            },
          },
        },
      }));
    });
    upstream.on("message", (raw) => {
      let event: OpenAiTranscriptionEvent;
      try {
        event = JSON.parse(raw.toString()) as OpenAiTranscriptionEvent;
      } catch {
        return;
      }
      if (event.type === "session.updated" || event.type === "transcription_session.updated") {
        send({ t: "ready", leaseId });
        return;
      }
      if (event.type === "input_audio_buffer.committed" && event.item_id) {
        committed.push(event.item_id);
        flush();
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
        const matched = matchDetectedLanguage(event.languages?.[0]?.code, target.languages);
        completed.set(event.item_id, {
          contentIndex: event.content_index ?? 0,
          body: event.transcript?.trim() ?? "",
          lang: matched ?? target.page.lang,
          usedFallback: !matched,
        });
        flush();
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
      upstream.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audio.toString("base64"),
      }));
      return;
    }

    let message: { t?: string; speakerName?: string };
    try {
      message = JSON.parse(raw.toString()) as { t?: string; speakerName?: string };
    } catch {
      return;
    }
    if (message.t === "start" && !started) {
      speakerName = message.speakerName?.trim().slice(0, 40) || null;
      if (target.meeting.speakerLabels && !speakerName) {
        fail("speaker-required");
        return;
      }
      started = true;
      start();
    } else if (message.t === "heartbeat" && leaseId) {
      if (!renewCapture(target.page.id, leaseId)) fail("lost");
    } else if (message.t === "commit" && upstream?.readyState === WsSocket.OPEN) {
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

main().catch((error: unknown) => {
  console.error("[server] 기동 실패", error);
  process.exit(1);
});
