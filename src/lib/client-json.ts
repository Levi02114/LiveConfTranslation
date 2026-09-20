/* oxlint-disable anti-slop/no-runtime-typeof -- This file is the I/O boundary parser that establishes each public network contract. */

import type { Peer, ServerMessage, SessionConnections } from "@/lib/realtime/protocol";
import type { VoiceSettings } from "./voice-settings";

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

export type RealtimeSessionPayload = {
  leaseId: string;
  clientSecret: string;
  realtimeUrl: string;
};
export type TranscriptionEventPayload = {
  type?: string;
  itemId?: string;
  contentIndex?: number;
  delta?: string;
  transcript?: string;
};
export type VoiceEventPayload =
  | { t: "voice-settings"; settings: VoiceSettings }
  | { t: "ready"; leaseId: string }
  | { t: "partial"; text: string }
  | {
      t: "transcript";
      itemId: string;
      contentIndex: number;
      body: string;
      lang: string;
      usedFallback: boolean;
      leaseId: string;
    }
  | {
      t: "error";
      reason:
        | "busy"
        | "key-required"
        | "google-unavailable"
        | "local-unavailable"
        | "speaker-required"
        | "invalid-language"
        | "lost";
    };
export type MessageResponsePayload = {
  usedFallback?: boolean;
  error?: string;
  message?: { lang?: string };
};

function objectFromJson(text: string): JsonObject | null {
  try {
    // SAFETY: JSON.parse produces JSON representations; domain fields are checked below.
    const value = JSON.parse(text) as JsonValue;
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: JsonValue | undefined): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function nullableString(value: JsonValue | undefined): value is string | null {
  return value === null || typeof value === "string";
}

function numberValue(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableNumber(value: JsonValue | undefined): value is number | null {
  return value === null || numberValue(value);
}

function peer(value: JsonValue): Peer | null {
  if (
    !isObject(value) ||
    typeof value.clientId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.typing !== "boolean" ||
    typeof value.draft !== "string"
  ) return null;
  return {
    clientId: value.clientId,
    name: value.name,
    typing: value.typing,
    draft: value.draft,
  };
}

export function parseRealtimeSession(text: string): RealtimeSessionPayload | null {
  const row = objectFromJson(text);
  return row &&
    typeof row.leaseId === "string" &&
    typeof row.clientSecret === "string" &&
    typeof row.realtimeUrl === "string"
    ? { leaseId: row.leaseId, clientSecret: row.clientSecret, realtimeUrl: row.realtimeUrl }
    : null;
}

export function parseTranscriptionEvent(text: string): TranscriptionEventPayload | null {
  const row = objectFromJson(text);
  if (!row || !optionalString(row.type) || !optionalString(row.item_id)) return null;
  if (row.content_index !== undefined && typeof row.content_index !== "number") return null;
  if (!optionalString(row.delta) || !optionalString(row.transcript)) return null;
  return {
    type: row.type,
    itemId: row.item_id,
    contentIndex: row.content_index,
    delta: row.delta,
    transcript: row.transcript,
  };
}

export function parseVoiceEvent(text: string): VoiceEventPayload | null {
  const row = objectFromJson(text);
  if (!row) return null;
  if (row.t === "voice-settings") {
    const settings = row.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
      (settings.mode !== "auto" && settings.mode !== "manual") || typeof settings.silenceMs !== "number" ||
      !Number.isInteger(settings.silenceMs) || settings.silenceMs < 300 || settings.silenceMs > 5000 || settings.silenceMs % 100 !== 0) return null;
    const parsed: VoiceSettings = { mode: settings.mode, silenceMs: settings.silenceMs };
    if (settings.languages !== undefined) {
      if (!settings.languages || typeof settings.languages !== "object" || Array.isArray(settings.languages)) return null;
      parsed.languages = {};
      for (const [lang, value] of Object.entries(settings.languages)) {
        if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang) || !value || typeof value !== "object" || Array.isArray(value) ||
          (value.mode !== "auto" && value.mode !== "manual") || typeof value.silenceMs !== "number" ||
          !Number.isInteger(value.silenceMs) || value.silenceMs < 300 || value.silenceMs > 5000 || value.silenceMs % 100 !== 0) return null;
        parsed.languages[lang] = { mode: value.mode, silenceMs: value.silenceMs };
      }
    }
    return { t: "voice-settings", settings: parsed };
  }
  if (row.t === "ready" && typeof row.leaseId === "string") {
    return { t: row.t, leaseId: row.leaseId };
  }
  if (row.t === "partial" && typeof row.text === "string") {
    return { t: row.t, text: row.text };
  }
  if (
    row.t === "transcript" &&
    typeof row.itemId === "string" &&
    typeof row.contentIndex === "number" &&
    typeof row.body === "string" &&
    typeof row.lang === "string" &&
    typeof row.usedFallback === "boolean" &&
    typeof row.leaseId === "string"
  ) {
    return {
      t: row.t,
      itemId: row.itemId,
      contentIndex: row.contentIndex,
      body: row.body,
      lang: row.lang,
      usedFallback: row.usedFallback,
      leaseId: row.leaseId,
    };
  }
  if (row.t !== "error") return null;
  switch (row.reason) {
    case "busy":
    case "key-required":
    case "google-unavailable":
    case "local-unavailable":
    case "speaker-required":
    case "invalid-language":
    case "lost":
      return { t: row.t, reason: row.reason };
    default:
      return null;
  }
}

export function parseMessageResponse(text: string): MessageResponsePayload | null {
  const row = objectFromJson(text);
  if (!row) return null;
  if (row.usedFallback !== undefined && typeof row.usedFallback !== "boolean") return null;
  if (!optionalString(row.error)) return null;
  let message: MessageResponsePayload["message"];
  if (row.message !== undefined) {
    if (!isObject(row.message) || !optionalString(row.message.lang)) return null;
    message = { lang: row.message.lang };
  }
  return {
    usedFallback: row.usedFallback,
    error: row.error,
    message,
  };
}

export function parseServerMessage(text: string): ServerMessage | null {
  const row = objectFromJson(text);
  if (!row) return null;
  if (row.t === "app-settings-changed") return { t: "app-settings-changed" };
  if (row.t === "connection-stats") {
    if (typeof row.snapshot !== "boolean" || !numberValue(row.at) || !Array.isArray(row.sessions) || !Array.isArray(row.removed)) return null;
    const count = (value: JsonValue | undefined): value is number => numberValue(value) && Number.isSafeInteger(value) && value >= 0;
    const sessions: SessionConnections[] = [];
    for (const item of row.sessions) {
      if (!isObject(item) || typeof item.meetingId !== "string" || (item.status !== "open" && item.status !== "closed") ||
        !count(item.total) || !count(item.combinedInput) || !count(item.combined) || !count(item.capture) || !Array.isArray(item.languages)) return null;
      const languages: SessionConnections["languages"] = [];
      for (const language of item.languages) {
        if (!isObject(language) || typeof language.lang !== "string" || !count(language.input) || !count(language.output)) return null;
        languages.push({ lang: language.lang, input: language.input, output: language.output });
      }
      sessions.push({ meetingId: item.meetingId, status: item.status, total: item.total, combinedInput: item.combinedInput, combined: item.combined, capture: item.capture, languages });
    }
    const removed = row.removed.filter((value): value is string => typeof value === "string");
    return removed.length === row.removed.length ? { t: row.t, snapshot: row.snapshot, at: row.at, sessions, removed } : null;
  }
  if (row.t === "security-changed") return { t: row.t };
  if (row.t === "translation-jobs" && isObject(row.counts) && numberValue(row.counts.pending) && numberValue(row.counts.running) && numberValue(row.counts.failed)) {
    const providers: Record<string, { active: number; blockedUntil: number }> = {};
    if (isObject(row.providers)) for (const [name, value] of Object.entries(row.providers)) {
      if (isObject(value) && numberValue(value.active) && numberValue(value.blockedUntil)) providers[name] = { active: value.active, blockedUntil: value.blockedUntil };
    }
    return { t: row.t, counts: { pending: row.counts.pending, running: row.counts.running, failed: row.counts.failed }, providers };
  }
  if (row.t === "hello" && typeof row.clientId === "string" && typeof row.name === "string") {
    return { t: row.t, clientId: row.clientId, name: row.name };
  }
  if (row.t === "name-result") {
    if (row.ok === true && typeof row.name === "string") {
      return { t: row.t, ok: row.ok, name: row.name };
    }
    if (row.ok === false && row.reason === "duplicate") {
      return { t: row.t, ok: row.ok, reason: row.reason };
    }
    return null;
  }
  if (
    row.t === "message" &&
    numberValue(row.messageId) &&
    nullableString(row.pageId) &&
    typeof row.lang === "string" &&
    typeof row.body === "string" &&
    nullableString(row.speakerName) &&
    numberValue(row.revision) &&
    Number.isInteger(row.revision) &&
    row.revision >= 0 &&
    nullableNumber(row.editedAt) &&
    numberValue(row.createdAt)
  ) {
    return {
      t: row.t,
      messageId: row.messageId,
      pageId: row.pageId,
      lang: row.lang,
      body: row.body,
      speakerName: row.speakerName,
      revision: row.revision,
      editedAt: row.editedAt,
      createdAt: row.createdAt,
    };
  }
  if (
    row.t === "translation" &&
    numberValue(row.messageId) &&
    typeof row.sourceLang === "string" &&
    typeof row.lang === "string" &&
    typeof row.body === "string" &&
    nullableString(row.speakerName) &&
    typeof row.engine === "string" &&
    (row.status === "ok" || row.status === "error") &&
    optionalString(row.error) &&
    numberValue(row.revision) &&
    Number.isInteger(row.revision) &&
    row.revision >= 0 &&
    nullableNumber(row.editedAt) &&
    numberValue(row.sourceCreatedAt) &&
    numberValue(row.createdAt)
  ) {
    return {
      t: row.t,
      messageId: row.messageId,
      sourceLang: row.sourceLang,
      lang: row.lang,
      body: row.body,
      speakerName: row.speakerName,
      engine: row.engine,
      status: row.status,
      error: row.error,
      revision: row.revision,
      editedAt: row.editedAt,
      sourceCreatedAt: row.sourceCreatedAt,
      createdAt: row.createdAt,
    };
  }
  if (row.t === "presence" && Array.isArray(row.peers)) {
    const peers: Peer[] = [];
    for (const value of row.peers) {
      const item = peer(value);
      if (!item) return null;
      peers.push(item);
    }
    return { t: row.t, peers };
  }
  if (row.t === "voice-stop") return { t: row.t };
  if (row.t === "meeting-closed" && numberValue(row.closedAt)) {
    return { t: row.t, closedAt: row.closedAt };
  }
  return null;
}
