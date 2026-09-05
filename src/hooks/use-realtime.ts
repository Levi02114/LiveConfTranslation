"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseServerMessage } from "@/lib/client-json";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/protocol";

export type ConnectionState = "connecting" | "open" | "closed";
export type RealtimeConnection = {
  state: ConnectionState;
  send: (message: ClientMessage) => void;
};

const MAX_DRAFT_BUFFERED_BYTES = 64 * 1024;

export function shouldSendRealtimeMessage(
  message: ClientMessage,
  bufferedAmount: number,
): boolean {
  return message.t !== "draft" || !message.text || bufferedAmount <= MAX_DRAFT_BUFFERED_BYTES;
}

/**
 * 서버(`server.ts`)의 `/ws` 에 붙어 실시간 메시지를 받는다.
 *
 * `query` 는 `token=...`(페이지) 또는 `meeting=...`(대시보드) 이다.
 *
 * 회의는 몇 시간씩 이어지고 참석자는 노트북 뚜껑을 닫았다 연다. 끊기면 조용히
 * 다시 붙어야 하므로 재연결을 내장한다. 간격을 점점 늘리는 이유는 서버가 죽어
 * 있을 때 수십 명이 1초마다 두드리는 상황을 막기 위해서다.
 */
export function useRealtime(
  query: string,
  onMessage: (message: ServerMessage) => void,
): RealtimeConnection {
  const [state, setState] = useState<ConnectionState>("connecting");
  const socketRef = useRef<WebSocket | null>(null);

  // 콜백이 매 렌더 바뀌어도 소켓을 다시 열지 않도록 ref 로 우회한다.
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let disposed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;

      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${window.location.host}/ws?${query}`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        retry = 0;
        setState("open");
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        const message = parseServerMessage(String(event.data));
        // 알 수 없는 프레임 하나 때문에 연결을 끊지는 않는다.
        if (message) handlerRef.current(message);
      };

      socket.onclose = () => {
        if (disposed) return;
        setState("closed");
        socketRef.current = null;
        // 0.5s → 1s → 2s → … 최대 10s
        const delay = Math.min(10_000, 500 * 2 ** retry);
        retry += 1;
        timer = setTimeout(connect, delay);
      };

      // onclose 가 뒤따라 오므로 여기서는 재연결을 걸지 않는다.
      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      const socket = socketRef.current;
      socketRef.current = null;
      // 정리 중의 close 가 재연결을 부르지 않도록 핸들러부터 뗀다.
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [query]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (
      socket &&
      socket.readyState === WebSocket.OPEN &&
      shouldSendRealtimeMessage(message, socket.bufferedAmount)
    ) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  return { state, send };
}
