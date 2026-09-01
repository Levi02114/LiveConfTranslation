import { z } from "zod";

/**
 * 브라우저와 서버가 WebSocket 으로 주고받는 메시지.
 *
 * 서버(`server.ts`)와 클라이언트 훅이 같은 정의를 쓰도록 여기 한 곳에 둔다.
 * 필드명을 짧게(`t`) 쓰는 이유는 초안(draft)이 타이핑마다 오가기 때문이다.
 */

/** 같은 입력 페이지에 들어와 있는 다른 속기사 */
const peerSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  typing: z.boolean(),
  draft: z.string(),
});
export type Peer = z.infer<typeof peerSchema>;

export const serverMessageSchema = z.union([
  z.object({ t: z.literal("hello"), clientId: z.string(), name: z.string() }),
  z.object({ t: z.literal("name-result"), ok: z.literal(true), name: z.string() }),
  z.object({ t: z.literal("name-result"), ok: z.literal(false), reason: z.literal("duplicate") }),
  z.object({
    t: z.literal("message"),
    messageId: z.number(),
    pageId: z.string().nullable(),
    lang: z.string(),
    body: z.string(),
    speakerName: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    editedAt: z.number().nullable(),
    createdAt: z.number(),
  }),
  z.object({
    t: z.literal("translation"),
    messageId: z.number(),
    sourceLang: z.string(),
    lang: z.string(),
    body: z.string(),
    speakerName: z.string().nullable(),
    engine: z.string(),
    status: z.enum(["ok", "error"]),
    error: z.string().optional(),
    revision: z.number().int().nonnegative(),
    editedAt: z.number().nullable(),
    sourceCreatedAt: z.number(),
    createdAt: z.number(),
  }),
  z.object({ t: z.literal("presence"), peers: z.array(peerSchema) }),
  z.object({ t: z.literal("voice-stop") }),
  z.object({ t: z.literal("meeting-closed"), closedAt: z.number() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

const clientMessageSchema = z.union([
  z.object({ t: z.literal("draft"), text: z.string() }),
  z.object({ t: z.literal("name"), name: z.string() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = clientMessageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.t === "draft") {
      // 초안은 저장되지 않지만 브로드캐스트되므로 길이를 막아 둔다.
      return { t: "draft", text: parsed.data.text.slice(0, 5000) };
    }
    return { t: "name", name: parsed.data.name.slice(0, 40) };
  } catch {
    return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed = serverMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
