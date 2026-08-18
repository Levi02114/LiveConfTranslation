import type { LanguageCode } from "@/lib/languages";

/**
 * 브라우저와 서버가 WebSocket 으로 주고받는 메시지.
 *
 * 서버(`server.ts`)와 클라이언트 훅이 같은 정의를 쓰도록 여기 한 곳에 둔다.
 * 필드명을 짧게(`t`) 쓰는 이유는 초안(draft)이 타이핑마다 오가기 때문이다.
 */

/** 같은 입력 페이지에 들어와 있는 다른 속기사 */
export type Peer = {
  clientId: string;
  name: string;
  /** 지금 입력창에 뭔가 쓰고 있는지 */
  typing: boolean;
  /** 작성 중인 문장. 읽기 전용으로 보여 준다. */
  draft: string;
};

export type ServerMessage =
  /** 연결 직후 1회. 클라이언트가 자기 식별자를 알게 된다. */
  | { t: "hello"; clientId: string; name: string }
  /** 표시 이름 등록 결과 */
  | { t: "name-result"; ok: true; name: string }
  | { t: "name-result"; ok: false; reason: "duplicate" }
  /** 원문이 들어왔다 */
  | {
      t: "message";
      messageId: number;
      lang: LanguageCode;
      body: string;
      speakerName: string | null;
      createdAt: number;
    }
  /** 번역이 나왔다 */
  | {
      t: "translation";
      messageId: number;
      sourceLang: LanguageCode;
      lang: LanguageCode;
      body: string;
      speakerName: string | null;
      engine: string;
      status: "ok" | "error";
      error?: string;
      createdAt: number;
    }
  /** 같은 입력 페이지의 접속자 목록이 바뀌었다 */
  | { t: "presence"; peers: Peer[] }
  /** 회의가 종료되었다 */
  | { t: "meeting-closed"; closedAt: number };

export type ClientMessage =
  /** 작성 중인 문장을 알린다. 저장되지 않는다. */
  | { t: "draft"; text: string }
  /** 표시 이름을 정한다 */
  | { t: "name"; name: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;

    const message = value as { t?: unknown; text?: unknown; name?: unknown };

    if (message.t === "draft" && typeof message.text === "string") {
      // 초안은 저장되지 않지만 브로드캐스트되므로 길이를 막아 둔다.
      return { t: "draft", text: message.text.slice(0, 5000) };
    }
    if (message.t === "name" && typeof message.name === "string") {
      return { t: "name", name: message.name.slice(0, 40) };
    }
    return null;
  } catch {
    return null;
  }
}
