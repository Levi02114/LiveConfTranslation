"use client";

import { useEffect, useState } from "react";
import { useRealtime } from "./use-realtime";
import type { SessionConnections } from "@/lib/realtime/protocol";

export function useConnectionStats() {
  const [sessions, setSessions] = useState<Map<string, SessionConnections>>(new Map());
  const [at, setAt] = useState<number | null>(null);
  const { state } = useRealtime("stats=1", (message) => {
    if (message.t === "app-settings-changed") {
      window.dispatchEvent(new Event("lct-app-settings"));
      return;
    }
    if (message.t !== "connection-stats") return;
    setSessions((previous) => {
      const next = message.snapshot ? new Map<string, SessionConnections>() : new Map(previous);
      for (const id of message.removed) next.delete(id);
      for (const session of message.sessions) next.set(session.meetingId, session);
      return next;
    });
    setAt(message.at);
  });
  useEffect(() => {
    if (state === "closed") window.dispatchEvent(new Event("lct-admin-disconnected"));
  }, [state]);
  return { sessions, at, state };
}
