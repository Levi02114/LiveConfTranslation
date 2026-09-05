import { z } from "zod";

/**
 * 브라우저와 서버가 WebSocket 으로 주고받는 메시지.
 *
 * 서버(`server.ts`)와 클라이언트 훅이 같은 정의를 쓰도록 여기 한 곳에 둔다.
 * 필드명을 짧게(`t`) 쓰는 이유는 초안(draft)이 타이핑마다 오가기 때문이다.
 */

/** 같은 입력 페이지에 들어와 있는 다른 속기사 */
export type Peer = { clientId: string; name: string; typing: boolean; draft: string };

export type ServerMessage =
  | { t: "hello"; clientId: string; name: string }
  | { t: "name-result"; ok: true; name: string }
  | { t: "name-result"; ok: false; reason: "duplicate" }
  | {
      t: "message";
      messageId: number;
      pageId: string | null;
      lang: string;
      body: string;
      speakerName: string | null;
      revision: number;
      editedAt: number | null;
      createdAt: number;
    }
  | {
      t: "translation";
      messageId: number;
      sourceLang: string;
      lang: string;
      body: string;
      speakerName: string | null;
      engine: string;
      status: "ok" | "error";
      error?: string;
      revision: number;
      editedAt: number | null;
      sourceCreatedAt: number;
      createdAt: number;
    }
  | { t: "presence"; peers: Peer[] }
  | { t: "voice-stop" }
  | { t: "meeting-closed"; closedAt: number };

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
