/*
 * 이 모듈에는 `server-only` 를 걸지 않는다.
 *
 * 커스텀 서버(`server.ts`)가 Next 번들러를 거치지 않고 직접 불러오는데,
 * `server-only` 는 번들러 밖에서 로드되면 무조건 던지도록 만들어진 패키지다.
 *
 * 대신 이 파일은 node: 내장 모듈에 의존하므로, 클라이언트 컴포넌트에서 잘못
 * 불러오면 번들 단계에서 바로 실패한다 — 보호는 그대로 유지된다.
 */
import { getDb } from "@/lib/db";
import { newId, newPageToken } from "@/lib/ids";
import type { LanguageCode } from "@/lib/languages";
import {
  type LogLine,
  formatSourceLine,
  formatTranslationLine,
} from "@/lib/log-format";
import type { EngineId } from "@/lib/translate/types";

/**
 * 데이터 접근 계층.
 *
 * SQL 은 전부 여기 모아 둔다. 라우트 핸들러가 스키마를 직접 알지 않게 해서,
 * 테이블이 바뀔 때 고칠 곳을 한 파일로 묶는다.
 */

export type MeetingStatus = "open" | "closed";
export type PageKind = "input" | "output" | "combined";

/**
 * 통합 보기 페이지는 특정 언어에 속하지 않는다.
 *
 * `pages` 는 (회의, 종류, 언어) 조합에 UNIQUE 를 걸어 중복 생성을 막는데,
 * SQLite 는 NULL 을 서로 다른 값으로 취급해 NULL 을 넣으면 그 제약이 무너진다.
 * 그래서 DB 에는 이 표식을 넣고, 앱 쪽에서는 `null` 로 다룬다.
 */
const NO_LANG = "*";

export type Meeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  engine: EngineId;
  createdAt: number;
  closedAt: number | null;
};

export type Page = {
  id: string;
  meetingId: string;
  kind: PageKind;
  /** 통합 보기 페이지는 `null` */
  lang: LanguageCode | null;
  token: string;
  createdAt: number;
};

export type Message = {
  id: number;
  meetingId: string;
  pageId: string | null;
  lang: LanguageCode;
  body: string;
  createdAt: number;
};

export type Translation = {
  id: number;
  messageId: number;
  lang: LanguageCode;
  body: string;
  engine: string;
  status: "ok" | "error";
  error: string | null;
  createdAt: number;
};

/** 여러 문을 원자적으로 실행한다. 중간에 던지면 전부 되돌린다. */
function transaction<T>(work: () => T): T {
  getDb().exec("BEGIN");
  try {
    const result = work();
    getDb().exec("COMMIT");
    return result;
  } catch (error) {
    getDb().exec("ROLLBACK");
    throw error;
  }
}

// node:sqlite 는 null 프로토타입 객체를 돌려준다. 필드명을 앱 규약(camelCase)으로 옮긴다.
type MeetingRow = {
  id: string;
  title: string;
  status: string;
  engine: string;
  created_at: number;
  closed_at: number | null;
};

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    status: row.status as MeetingStatus,
    engine: row.engine as EngineId,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

type PageRow = {
  id: string;
  meeting_id: string;
  kind: string;
  lang: string;
  token: string;
  created_at: number;
};

function toPage(row: PageRow): Page {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    kind: row.kind as PageKind,
    lang: row.lang === NO_LANG ? null : (row.lang as LanguageCode),
    token: row.token,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------- 회의

/**
 * 회의를 만들고, 언어마다 입력·출력 페이지를 함께 생성한다.
 *
 * 페이지를 나중에 따로 만들지 않고 한 트랜잭션에 묶는 이유는, 관리자가 대시보드를
 * 열었을 때 배포할 URL 이 이미 전부 준비되어 있어야 하기 때문이다.
 */
export function createMeeting(input: {
  title: string;
  langs: readonly LanguageCode[];
  engine: EngineId;
}): Meeting {
  const now = Date.now();
  const id = newId();

  return transaction(() => {
    getDb().prepare(
      `INSERT INTO meetings (id, title, status, engine, created_at)
       VALUES (?, ?, 'open', ?, ?)`,
    ).run(id, input.title, input.engine, now);

    const insertLang = getDb().prepare(
      `INSERT INTO meeting_langs (meeting_id, lang, position) VALUES (?, ?, ?)`,
    );
    const insertPage = getDb().prepare(
      `INSERT INTO pages (id, meeting_id, kind, lang, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    input.langs.forEach((lang, position) => {
      insertLang.run(id, lang, position);
      for (const kind of ["input", "output"] as const) {
        insertPage.run(newId(), id, kind, lang, newPageToken(), now);
      }
    });

    // 모든 언어를 한 화면에서 보는 페이지. 회의당 하나.
    insertPage.run(newId(), id, "combined", NO_LANG, newPageToken(), now);

    return {
      id,
      title: input.title,
      status: "open" as const,
      engine: input.engine,
      createdAt: now,
      closedAt: null,
    };
  });
}

export function listMeetings(): Meeting[] {
  const rows = getDb()
    .prepare(`SELECT * FROM meetings ORDER BY created_at DESC`)
    .all() as unknown as MeetingRow[];
  return rows.map(toMeeting);
}

export function getMeeting(id: string): Meeting | null {
  const row = getDb().prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as
    | unknown
    | undefined;
  return row ? toMeeting(row as MeetingRow) : null;
}

export function getMeetingLangs(meetingId: string): LanguageCode[] {
  const rows = getDb()
    .prepare(`SELECT lang FROM meeting_langs WHERE meeting_id = ? ORDER BY position`)
    .all(meetingId) as unknown as { lang: string }[];
  return rows.map((row) => row.lang as LanguageCode);
}

export function closeMeeting(id: string): void {
  getDb().prepare(`UPDATE meetings SET status = 'closed', closed_at = ? WHERE id = ?`).run(
    Date.now(),
    id,
  );
}

// ---------------------------------------------------------------- 페이지

export function getMeetingPages(meetingId: string): Page[] {
  // LEFT JOIN 이어야 통합 보기 페이지(언어 없음)가 빠지지 않는다.
  // 통합 보기는 목록 맨 뒤로 보낸다.
  const rows = getDb()
    .prepare(
      `SELECT p.* FROM pages p
       LEFT JOIN meeting_langs ml
         ON ml.meeting_id = p.meeting_id AND ml.lang = p.lang
       WHERE p.meeting_id = ?
       ORDER BY (p.kind = 'combined'), ml.position, p.kind`,
    )
    .all(meetingId) as unknown as PageRow[];
  return rows.map(toPage);
}

export function getPageByToken(token: string): Page | null {
  const row = getDb().prepare(`SELECT * FROM pages WHERE token = ?`).get(token) as
    | unknown
    | undefined;
  return row ? toPage(row as PageRow) : null;
}

// ---------------------------------------------------------------- 메시지 / 번역

export function insertMessage(input: {
  meetingId: string;
  pageId: string | null;
  lang: LanguageCode;
  body: string;
}): Message {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO messages (meeting_id, page_id, lang, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.meetingId, input.pageId, input.lang, input.body, now);

  return {
    id: Number(result.lastInsertRowid),
    meetingId: input.meetingId,
    pageId: input.pageId,
    lang: input.lang,
    body: input.body,
    createdAt: now,
  };
}

/**
 * 번역 결과를 저장한다.
 *
 * 같은 (메시지, 언어) 조합이 다시 들어오면 덮어쓴다 — 실패한 번역을 재시도했을 때
 * 로그에 실패 줄과 성공 줄이 나란히 남지 않게 하기 위해서다.
 */
export function upsertTranslation(input: {
  messageId: number;
  lang: LanguageCode;
  body: string;
  engine: string;
  status: "ok" | "error";
  error?: string | null;
}): number {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO translations (message_id, lang, body, engine, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (message_id, lang) DO UPDATE SET
       body = excluded.body,
       engine = excluded.engine,
       status = excluded.status,
       error = excluded.error,
       created_at = excluded.created_at`,
  ).run(
    input.messageId,
    input.lang,
    input.body,
    input.engine,
    input.status,
    input.error ?? null,
    now,
  );
  return now;
}

/** 대시보드가 처음 열릴 때 채워 넣을 최근 원문 */
export function getRecentMessages(meetingId: string, limit = 200): Message[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM messages WHERE meeting_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(meetingId, limit) as unknown as {
    id: number;
    meeting_id: string;
    page_id: string | null;
    lang: string;
    body: string;
    created_at: number;
  }[];

  return rows.reverse().map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    pageId: row.page_id,
    lang: row.lang as LanguageCode,
    body: row.body,
    createdAt: row.created_at,
  }));
}

/**
 * 출력 페이지가 처음 열릴 때 채워 넣을 최근 번역.
 *
 * 회의 중간에 들어온 참석자도 앞의 흐름을 볼 수 있어야 하므로, SSE 만으로
 * 두지 않고 초기 이력을 함께 내려 준다.
 */
export function getRecentTranslations(
  meetingId: string,
  lang: LanguageCode,
  limit = 200,
): (Translation & { sourceLang: LanguageCode; sourceBody: string })[] {
  const rows = getDb()
    .prepare(
      `SELECT t.*, m.lang AS source_lang, m.body AS source_body
       FROM translations t
       JOIN messages m ON m.id = t.message_id
       WHERE m.meeting_id = ? AND t.lang = ?
       ORDER BY t.message_id DESC
       LIMIT ?`,
    )
    .all(meetingId, lang, limit) as unknown as {
    id: number;
    message_id: number;
    lang: string;
    body: string;
    engine: string;
    status: string;
    error: string | null;
    created_at: number;
    source_lang: string;
    source_body: string;
  }[];

  return rows.reverse().map((row) => ({
    id: row.id,
    messageId: row.message_id,
    lang: row.lang as LanguageCode,
    body: row.body,
    engine: row.engine,
    status: row.status as "ok" | "error",
    error: row.error,
    createdAt: row.created_at,
    sourceLang: row.source_lang as LanguageCode,
    sourceBody: row.source_body,
  }));
}

/** 페이지 헤더의 "입력/출력 상태"에 쓰는 요약 */
export function getMeetingActivity(meetingId: string): {
  messageCount: number;
  translationCount: number;
  lastMessageAt: number | null;
  lastTranslationAt: number | null;
  failedTranslationCount: number;
} {
  const messages = getDb()
    .prepare(
      `SELECT COUNT(*) AS c, MAX(created_at) AS last FROM messages WHERE meeting_id = ?`,
    )
    .get(meetingId) as unknown as { c: number; last: number | null };

  const translations = getDb()
    .prepare(
      `SELECT COUNT(*) AS c,
              MAX(t.created_at) AS last,
              SUM(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END) AS failed
       FROM translations t
       JOIN messages m ON m.id = t.message_id
       WHERE m.meeting_id = ?`,
    )
    .get(meetingId) as unknown as {
    c: number;
    last: number | null;
    failed: number | null;
  };

  return {
    messageCount: messages.c,
    translationCount: translations.c,
    lastMessageAt: messages.last,
    lastTranslationAt: translations.last,
    failedTranslationCount: translations.failed ?? 0,
  };
}

// ---------------------------------------------------------------- 로그

/**
 * 회의 로그를 시간순으로 만든다.
 *
 * 원문 줄 바로 뒤에 그 원문의 번역 줄들이 붙는다. 번역이 원문보다 늦게 저장되지만
 * 로그에서는 항상 원문 → 번역 순서로 읽히게 `message_id` 기준으로 묶는다.
 *
 * `langs` 를 주면 해당 언어의 줄만 남긴다. 원문 줄은 그 원문의 언어로 판정한다.
 */
export function getLogLines(
  meetingId: string,
  langs?: readonly LanguageCode[],
): LogLine[] {
  const messages = getDb()
    .prepare(
      `SELECT id, lang, body, created_at FROM messages
       WHERE meeting_id = ? ORDER BY id`,
    )
    .all(meetingId) as unknown as {
    id: number;
    lang: string;
    body: string;
    created_at: number;
  }[];

  const translations = getDb()
    .prepare(
      `SELECT t.message_id, t.lang, t.body, t.status, t.created_at
       FROM translations t
       JOIN messages m ON m.id = t.message_id
       WHERE m.meeting_id = ? AND t.status = 'ok'
       ORDER BY t.message_id, t.lang`,
    )
    .all(meetingId) as unknown as {
    message_id: number;
    lang: string;
    body: string;
    status: string;
    created_at: number;
  }[];

  const byMessage = new Map<number, typeof translations>();
  for (const row of translations) {
    const bucket = byMessage.get(row.message_id);
    if (bucket) bucket.push(row);
    else byMessage.set(row.message_id, [row]);
  }

  const wanted = langs?.length ? new Set(langs) : null;
  const lines: LogLine[] = [];

  for (const message of messages) {
    const sourceLang = message.lang as LanguageCode;
    if (!wanted || wanted.has(sourceLang)) {
      lines.push({
        at: message.created_at,
        lang: sourceLang,
        kind: "source",
        text: formatSourceLine(message.created_at, message.body),
      });
    }

    for (const translation of byMessage.get(message.id) ?? []) {
      const lang = translation.lang as LanguageCode;
      if (wanted && !wanted.has(lang)) continue;
      lines.push({
        at: translation.created_at,
        lang,
        kind: "translation",
        text: formatTranslationLine(translation.created_at, lang, translation.body),
      });
    }
  }

  return lines;
}

/**
 * LLM 번역에 문맥으로 넘길 직전 원문들.
 *
 * 회의는 앞 발언을 받아 이어지는 대화라, 대명사와 용어를 맞추려면 바로 앞 몇 줄이
 * 필요하다. 기계 번역 엔진은 이걸 쓰지 않는다.
 */
export function getRecentSourceBodies(
  meetingId: string,
  beforeMessageId: number,
  limit = 4,
): string[] {
  const rows = getDb()
    .prepare(
      `SELECT body FROM messages
       WHERE meeting_id = ? AND id < ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(meetingId, beforeMessageId, limit) as unknown as { body: string }[];

  return rows.reverse().map((row) => row.body);
}

/** 통합 보기 페이지가 처음 열릴 때 채울 이력: 원문 + 그 원문의 모든 번역 */
export type CombinedEntry = {
  messageId: number;
  sourceLang: LanguageCode;
  sourceBody: string;
  createdAt: number;
  translations: {
    lang: LanguageCode;
    body: string;
    status: "ok" | "error";
    error: string | null;
  }[];
};

export function getRecentCombined(meetingId: string, limit = 100): CombinedEntry[] {
  const messages = getRecentMessages(meetingId, limit);
  if (messages.length === 0) return [];

  // 메시지 목록이 정해진 뒤 번역을 한 번에 가져온다. 메시지마다 조회하면 N+1 이 된다.
  const placeholders = messages.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT message_id, lang, body, status, error FROM translations
       WHERE message_id IN (${placeholders})
       ORDER BY message_id, lang`,
    )
    .all(...messages.map((message) => message.id)) as unknown as {
    message_id: number;
    lang: string;
    body: string;
    status: string;
    error: string | null;
  }[];

  const byMessage = new Map<number, CombinedEntry["translations"]>();
  for (const row of rows) {
    const entry = {
      lang: row.lang as LanguageCode,
      body: row.body,
      status: row.status as "ok" | "error",
      error: row.error,
    };
    const bucket = byMessage.get(row.message_id);
    if (bucket) bucket.push(entry);
    else byMessage.set(row.message_id, [entry]);
  }

  return messages.map((message) => ({
    messageId: message.id,
    sourceLang: message.lang,
    sourceBody: message.body,
    createdAt: message.createdAt,
    translations: byMessage.get(message.id) ?? [],
  }));
}

// ---------------------------------------------------------- 엔진 API 키

/**
 * 저장된 번역 엔진 API 키.
 *
 * `secret` 은 암호문이다. 이 계층은 복호화하지 않는다 — 암호화 규칙은
 * `lib/crypto.ts` 에, 어떤 키를 쓸지 고르는 규칙은 `lib/secrets.ts` 에 둔다.
 */
export type EngineSecret = {
  engine: EngineId;
  secret: Uint8Array;
  hint: string;
  updatedAt: number;
};

/** 화면에 내려도 되는 부분만. 암호문이 라우트 밖으로 새지 않게 분리해 둔다. */
export type EngineSecretInfo = {
  engine: EngineId;
  hint: string;
  updatedAt: number;
};

export function upsertEngineSecret(input: {
  engine: EngineId;
  secret: Uint8Array;
  hint: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO engine_secrets (engine, secret, hint, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (engine) DO UPDATE SET
         secret = excluded.secret,
         hint = excluded.hint,
         updated_at = excluded.updated_at`,
    )
    .run(input.engine, input.secret, input.hint, Date.now());
}

export function getEngineSecret(engine: EngineId): EngineSecret | null {
  const row = getDb()
    .prepare(`SELECT engine, secret, hint, updated_at FROM engine_secrets WHERE engine = ?`)
    .get(engine) as unknown as
    | { engine: string; secret: Uint8Array; hint: string; updated_at: number }
    | undefined;

  if (!row) return null;

  return {
    engine: row.engine as EngineId,
    secret: row.secret,
    hint: row.hint,
    updatedAt: row.updated_at,
  };
}

export function listEngineSecrets(): EngineSecretInfo[] {
  const rows = getDb()
    .prepare(`SELECT engine, hint, updated_at FROM engine_secrets ORDER BY engine`)
    .all() as unknown as { engine: string; hint: string; updated_at: number }[];

  return rows.map((row) => ({
    engine: row.engine as EngineId,
    hint: row.hint,
    updatedAt: row.updated_at,
  }));
}

export function deleteEngineSecret(engine: EngineId): void {
  getDb().prepare(`DELETE FROM engine_secrets WHERE engine = ?`).run(engine);
}
