/**
 * 실시간 연결 허브.
 *
 * 회의별로 열려 있는 WebSocket 을 모아 두고, 각 연결이 **자기에게 필요한 것만**
 * 받도록 걸러서 내보낸다. 참석자 화면에 다른 언어 번역이 섞이면 안 되기 때문이다.
 *
 * Next.js 라우트 핸들러(번들된 모듈)와 커스텀 서버(`server.ts`, tsx 로 직접 실행)는
 * 서로 다른 모듈 인스턴스를 갖는다. 같은 프로세스이므로 `globalThis` 에 상태를 두어
 * 양쪽이 같은 허브를 보게 한다.
 */

import type { LanguageCode } from "@/lib/languages";

import type { Peer, ServerMessage } from "./protocol";

/** 연결 한 개. WebSocket 구현에 묶이지 않도록 `send` 만 요구한다. */
export type Connection = {
  clientId: string;
  meetingId: string;
  /** 이 연결이 붙은 페이지 성격. 대시보드는 회의 전체를 본다. */
  kind: "input" | "output" | "combined" | "dashboard";
  /** input/output 페이지의 언어. combined·dashboard 는 없다. */
  lang: LanguageCode | null;
  name: string;
  draft: string;
  send: (message: ServerMessage) => void;
};

type HubState = { rooms: Map<string, Set<Connection>> };

const globalForHub = globalThis as unknown as { __meetingHub?: HubState };

function state(): HubState {
  return (globalForHub.__meetingHub ??= { rooms: new Map() });
}

function room(meetingId: string): Set<Connection> {
  const rooms = state().rooms;
  let existing = rooms.get(meetingId);
  if (!existing) {
    existing = new Set();
    rooms.set(meetingId, existing);
  }
  return existing;
}

/**
 * 이 연결이 이 메시지를 받아야 하는가.
 *
 * 배포 규칙을 한 곳에 모아 둔다. 페이지 종류가 늘어도 여기만 보면 된다.
 */
function shouldDeliver(connection: Connection, message: ServerMessage): boolean {
  if (message.t === "meeting-closed" || message.t === "hello") return true;

  switch (connection.kind) {
    case "dashboard":
      // 관리자는 회의 전체를 감시한다.
      return true;

    case "combined":
      // 통합 보기는 원문과 모든 언어의 번역을 함께 본다.
      return message.t === "message" || message.t === "translation";

    case "output":
      // 참석자는 자기 언어 번역만 본다.
      return message.t === "translation" && message.lang === connection.lang;

    case "input":
      // 속기사는 자기 언어로 확정된 원문과, 같은 방의 접속자 상태를 본다.
      if (message.t === "presence") return true;
      return message.t === "message" && message.lang === connection.lang;
  }
}

export function join(connection: Connection): void {
  room(connection.meetingId).add(connection);
}

export function leave(connection: Connection): void {
  const connections = state().rooms.get(connection.meetingId);
  if (!connections) return;

  connections.delete(connection);
  if (connections.size === 0) state().rooms.delete(connection.meetingId);
}

/** 회의에 붙어 있는 모든 연결에 규칙대로 배포한다. */
export function publish(meetingId: string, message: ServerMessage): void {
  for (const connection of state().rooms.get(meetingId) ?? []) {
    if (!shouldDeliver(connection, message)) continue;
    try {
      connection.send(message);
    } catch {
      // 이미 끊긴 소켓. close 핸들러가 정리한다.
    }
  }
}

/** 같은 입력 페이지(회의 + 언어)에 들어와 있는 연결들 */
function inputPeers(meetingId: string, lang: LanguageCode): Connection[] {
  return [...(state().rooms.get(meetingId) ?? [])].filter(
    (connection) => connection.kind === "input" && connection.lang === lang,
  );
}

/**
 * 같은 입력 페이지의 접속자 상태를 서로에게 알린다.
 *
 * 자기 자신은 목록에서 뺀다 — 화면에 "나"를 남의 초안처럼 다시 보여 줄 이유가 없다.
 */
export function broadcastPresence(meetingId: string, lang: LanguageCode): void {
  const peers = inputPeers(meetingId, lang);

  for (const connection of peers) {
    const others: Peer[] = peers
      .filter((peer) => peer.clientId !== connection.clientId)
      .map((peer) => ({
        clientId: peer.clientId,
        name: peer.name,
        typing: peer.draft.length > 0,
        draft: peer.draft,
      }));

    try {
      connection.send({ t: "presence", peers: others });
    } catch {
      // 위와 같다.
    }
  }
}

/** 지금 이 입력 페이지에 몇 명이 붙어 있는지 (대시보드 표시에 쓴다) */
export function countInputPeers(meetingId: string, lang: LanguageCode): number {
  return inputPeers(meetingId, lang).length;
}
