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
import { randomUUID } from "node:crypto";

import next from "next";
import { WebSocketServer, type WebSocket } from "ws";

import { isAdminFromCookieHeader } from "@/lib/auth-core";
import type { LanguageCode } from "@/lib/languages";
import {
  broadcastPresence,
  type Connection,
  join,
  leave,
} from "@/lib/realtime/hub";
import { parseClientMessage, type ServerMessage } from "@/lib/realtime/protocol";
import { getMeeting, getPageByToken, listMeetings } from "@/lib/repo";

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

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

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
  if (!page) return null;
  if (!getMeeting(page.meetingId)) return null;

  return { meetingId: page.meetingId, kind: page.kind, lang: page.lang };
}

function attach(ws: WebSocket, target: Target) {
  const clientId = randomUUID();

  // 이름은 입력 페이지에서만 쓰인다(서로를 구분해야 하므로). 보기 전용 연결에는
  // 번호를 붙이지 않는다 — 참석자에게 "입력자 3" 이라는 이름이 생기면 혼란스럽다.
  const name = target.kind === "input" ? `입력자 ${(anonymousCounter += 1)}` : "";

  const connection: Connection = {
    clientId,
    meetingId: target.meetingId,
    kind: target.kind,
    lang: target.lang,
    name,
    draft: "",
    send: (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
  };

  join(connection);
  connection.send({ t: "hello", clientId, name: connection.name });

  if (connection.kind === "input" && connection.lang) {
    broadcastPresence(connection.meetingId, connection.lang);
  }

  ws.on("message", (raw) => {
    const message = parseClientMessage(raw.toString());
    if (!message) return;

    // 초안과 이름은 입력 페이지에서만 의미가 있다.
    if (connection.kind !== "input" || !connection.lang) return;

    if (message.t === "draft") connection.draft = message.text;
    if (message.t === "name") connection.name = message.name.trim() || connection.name;

    broadcastPresence(connection.meetingId, connection.lang);
  });

  const cleanup = () => {
    leave(connection);
    if (connection.kind === "input" && connection.lang) {
      broadcastPresence(connection.meetingId, connection.lang);
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
