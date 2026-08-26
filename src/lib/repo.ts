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
import {
  bodyRowSchema,
  combinedTranslationRowSchema,
  engineSecretInfoRowSchema,
  engineSecretRowSchema,
  engineSettingRowSchema,
  glossaryEntryRowSchema,
  glossaryPairRowSchema,
  glossaryTermRowSchema,
  languageOnlyRowSchema,
  languageRowSchema,
  logMessageRowSchema,
  logTranslationRowSchema,
  maxPositionRowSchema,
  meetingLanguageConfigRowSchema,
  meetingRowSchema,
  meetingStatusSchema,
  messageCountRowSchema,
  messageRowSchema,
  openaiModelRowSchema,
  outputRowSchema,
  pageRowSchema,
  promptCueRowSchema,
  recentTranslationRowSchema,
  sessionPresetRowSchema,
  transcriptionSettingRowSchema,
  translationCountRowSchema,
  uiStringRowSchema,
  type MeetingRow,
  type PageRow,
  type StoredSecretId,
} from "@/lib/repo-schema";
import { parseRequiredSqlRow, parseSqlRow, parseSqlRows } from "@/lib/sqlite-schema";

/**
 * 데이터 접근 계층.
 *
 * SQL 은 전부 여기 모아 둔다. 라우트 핸들러가 스키마를 직접 알지 않게 해서,
 * 테이블이 바뀔 때 고칠 곳을 한 파일로 묶는다.
 */

export type MeetingStatus = "open" | "closed";
export type InputMode = "human" | "realtime";
export type TranscriptionProvider = "openai" | "google" | "local";
export type PageKind = "input" | "output" | "combined" | "combined-input" | "capture";

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
  fallbackEngine: EngineId | null;
  inputMode: InputMode;
  speakerLabels: boolean;
  translationModel: string | null;
  transcriptionProvider: TranscriptionProvider;
  /** 전사 프롬프트에 붙는 관리자 지정 문맥(의제·분야·화자 이름 등). */
  transcriptionContext: string | null;
  createdAt: number;
  closedAt: number | null;
};

export type Page = {
  id: string;
  meetingId: string;
  kind: PageKind;
  /** 통합 보기 페이지는 `null`, 통합 입력은 감지 실패 기본 언어 */
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
  speakerName: string | null;
  revision: number;
  editedAt: number | null;
  createdAt: number;
};

export type MeetingLanguageConfig = {
  lang: LanguageCode;
  inputEnabled: boolean;
  outputEnabled: boolean;
};

export type SessionPresetConfig = {
  languages: MeetingLanguageConfig[];
  speakerLabels: boolean;
  /** `null` 이면 통합 입력을 쓰지 않고, 값이 있으면 감지 실패 기본 언어다. */
  combinedInputFallbackLang: LanguageCode | null;
};

export type SessionPreset = SessionPresetConfig & {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
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
function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    engine: row.engine,
    fallbackEngine: row.fallback_engine,
    inputMode: row.input_mode,
    speakerLabels: Boolean(row.speaker_labels),
    translationModel: row.translation_model,
    transcriptionProvider: row.transcription_provider,
    transcriptionContext: row.transcription_context,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function toPage(row: PageRow): Page {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    kind: row.kind,
    lang: row.lang === NO_LANG ? null : row.lang,
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
  config: SessionPresetConfig;
  engine: EngineId;
  fallbackEngine?: EngineId | null;
  translationModel?: string | null;
  transcriptionProvider?: TranscriptionProvider;
}): Meeting {
  const now = Date.now();
  const id = newId();

  return transaction(() => {
    getDb().prepare(
      `INSERT INTO meetings
         (id, title, status, engine, fallback_engine, input_mode, speaker_labels,
          translation_model, transcription_provider, created_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.title,
      input.engine,
      input.fallbackEngine ?? null,
      "human",
      Number(input.config.speakerLabels),
      input.translationModel ?? null,
      input.transcriptionProvider ?? "openai",
      now,
    );

    const insertLang = getDb().prepare(
      `INSERT INTO meeting_langs
         (meeting_id, lang, position, input_enabled, output_enabled)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertPage = getDb().prepare(
      `INSERT INTO pages (id, meeting_id, kind, lang, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    input.config.languages.forEach((language, position) => {
      insertLang.run(
        id,
        language.lang,
        position,
        Number(language.inputEnabled),
        Number(language.outputEnabled),
      );
      insertPage.run(newId(), id, "input", language.lang, newPageToken(), now);
      insertPage.run(newId(), id, "output", language.lang, newPageToken(), now);
    });

    // 모든 언어를 한 화면에서 보는 페이지. 회의당 하나.
    insertPage.run(newId(), id, "combined", NO_LANG, newPageToken(), now);
    if (input.config.combinedInputFallbackLang) {
      insertPage.run(
        newId(),
        id,
        "combined-input",
        input.config.combinedInputFallbackLang,
        newPageToken(),
        now,
      );
    }

    return {
      id,
      title: input.title,
      status: "open" as const,
      engine: input.engine,
      fallbackEngine: input.fallbackEngine ?? null,
      inputMode: "human",
      speakerLabels: input.config.speakerLabels,
      translationModel: input.translationModel ?? null,
      transcriptionProvider: input.transcriptionProvider ?? "openai",
      transcriptionContext: null,
      createdAt: now,
      closedAt: null,
    };
  });
}

export function listMeetings(): Meeting[] {
  const rows = parseSqlRows(
    meetingRowSchema,
    getDb().prepare(`SELECT * FROM meetings ORDER BY created_at DESC`).all(),
    "meetings 목록",
  );
  return rows.map(toMeeting);
}

export function getMeeting(id: string): Meeting | null {
  const row = parseSqlRow(
    meetingRowSchema,
    getDb().prepare(`SELECT * FROM meetings WHERE id = ?`).get(id),
    "meeting 단건",
  );
  return row ? toMeeting(row) : null;
}

export function getMeetingLangs(meetingId: string): LanguageCode[] {
  const rows = parseSqlRows(
    languageOnlyRowSchema,
    getDb()
      .prepare(`SELECT lang FROM meeting_langs WHERE meeting_id = ? ORDER BY position`)
      .all(meetingId),
    "meeting_langs 언어 목록",
  );
  return rows.map((row) => row.lang);
}

export function getMeetingLanguageConfigs(meetingId: string): MeetingLanguageConfig[] {
  const rows = parseSqlRows(
    meetingLanguageConfigRowSchema,
    getDb().prepare(
      `SELECT lang, input_enabled, output_enabled FROM meeting_langs
       WHERE meeting_id = ? ORDER BY position`,
    ).all(meetingId),
    "meeting_langs 설정 목록",
  );
  return rows.map((row) => ({
    lang: row.lang,
    inputEnabled: Boolean(row.input_enabled),
    outputEnabled: Boolean(row.output_enabled),
  }));
}

/** 입력자 또는 일반 출력 이용자가 실제로 쓰는 언어만 번역 대상으로 삼는다. */
export function getMeetingActiveLangs(meetingId: string): LanguageCode[] {
  return getMeetingLanguageConfigs(meetingId)
    .filter((row) => row.inputEnabled || row.outputEnabled)
    .map((row) => row.lang);
}

export function isPageEnabled(page: Page): boolean {
  if (page.kind === "combined") return true;
  if (!page.lang) return false;
  const config = getMeetingLanguageConfigs(page.meetingId).find(
    (row) => row.lang === page.lang,
  );
  if (!config) return false;
  return page.kind === "output" ? config.outputEnabled : config.inputEnabled;
}

export function closeMeeting(id: string): void {
  getDb().prepare(`UPDATE meetings SET status = 'closed', closed_at = ? WHERE id = ?`).run(
    Date.now(),
    id,
  );
}

/**
 * 전사 문맥만 바꾼다. 페이지 구조가 아니라 다음 음성 세션의 프롬프트에만
 * 영향을 주므로, 첫 입력 후에도(운영 설정 잠김) 바꿀 수 있게 분리해 둔다.
 */
export function updateTranscriptionContext(
  meetingId: string,
  context: string | null,
) {
  const meeting = getMeeting(meetingId);
  if (!meeting || meeting.status !== "open") return { ok: false };
  const cleaned = context?.replace(/\s+/g, " ").trim().slice(0, 300) || null;
  getDb()
    .prepare(`UPDATE meetings SET transcription_context = ? WHERE id = ?`)
    .run(cleaned, meetingId);
  return { ok: true };
}

export function listSessionPresets(): SessionPreset[] {
  const rows = parseSqlRows(
    sessionPresetRowSchema,
    getDb().prepare(`SELECT * FROM session_presets ORDER BY updated_at DESC, name`).all(),
    "session_presets 목록",
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ...row.config_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function upsertSessionPreset(input: {
  id?: string;
  name: string;
  config: SessionPresetConfig;
}): SessionPreset {
  const now = Date.now();
  const id = input.id ?? newId();
  getDb()
    .prepare(
      `INSERT INTO session_presets (id, name, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
    )
    .run(id, input.name, JSON.stringify(input.config), now, now);
  return listSessionPresets().find((row) => row.id === id)!;
}

export function deleteSessionPreset(id: string): boolean {
  return getDb().prepare(`DELETE FROM session_presets WHERE id = ?`).run(id).changes > 0;
}

/** 종료된 세션과 그 하위 페이지·원문·번역을 실제로 삭제한다. */
export function deleteClosedMeeting(id: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM meetings WHERE id = ? AND status = 'closed'`)
    .run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------- 페이지

export function getMeetingPages(meetingId: string): Page[] {
  // LEFT JOIN 이어야 통합 보기 페이지(언어 없음)가 빠지지 않는다.
  // 통합 보기는 목록 맨 뒤로 보낸다.
  const rows = parseSqlRows(
    pageRowSchema,
    getDb().prepare(
      `SELECT p.* FROM pages p
       LEFT JOIN meeting_langs ml
         ON ml.meeting_id = p.meeting_id AND ml.lang = p.lang
       WHERE p.meeting_id = ?
       ORDER BY (p.kind = 'combined'), (p.kind = 'combined-input'), ml.position, p.kind`,
    ).all(meetingId),
    "pages 목록",
  );
  return rows.map(toPage);
}

export function getPageByToken(token: string): Page | null {
  const row = parseSqlRow(
    pageRowSchema,
    getDb().prepare(`SELECT * FROM pages WHERE token = ?`).get(token),
    "page 단건",
  );
  return row ? toPage(row) : null;
}

// ---------------------------------------------------------------- 메시지 / 번역

export function insertMessage(input: {
  meetingId: string;
  pageId: string | null;
  lang: LanguageCode;
  body: string;
  speakerName?: string | null;
}): Message {
  return insertMessageOnce(input).message;
}

/** AI 완료 이벤트 재전송 시 같은 원문을 두 번 만들지 않는다. */
export type InsertMessageResult = { message: Message; inserted: boolean };

export function insertMessageOnce(input: {
  meetingId: string;
  pageId: string | null;
  lang: LanguageCode;
  body: string;
  speakerName?: string | null;
  ingestKey?: string;
}): InsertMessageResult {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO messages
         (meeting_id, page_id, lang, body, speaker_name, ingest_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.meetingId,
      input.pageId,
      input.lang,
      input.body,
      input.speakerName ?? null,
      input.ingestKey ?? null,
      now,
    );

  if (result.changes === 0 && input.ingestKey) {
    const existing = parseRequiredSqlRow(
      messageRowSchema,
      getDb().prepare(`SELECT * FROM messages WHERE ingest_key = ?`).get(input.ingestKey),
      "중복 원문",
    );
    return {
      inserted: false,
      message: {
        id: existing.id,
        meetingId: existing.meeting_id,
        pageId: existing.page_id,
        lang: existing.lang,
        body: existing.body,
        speakerName: existing.speaker_name,
        revision: existing.revision,
        editedAt: existing.edited_at,
        createdAt: existing.created_at,
      },
    };
  }

  return {
    inserted: true,
    message: {
      id: Number(result.lastInsertRowid),
      meetingId: input.meetingId,
      pageId: input.pageId,
      lang: input.lang,
      body: input.body,
      speakerName: input.speakerName ?? null,
      revision: 0,
      editedAt: null,
      createdAt: now,
    },
  };
}

export type EditMessageResult =
  | { ok: true; message: Message }
  | { ok: false; reason: "not-found" | "closed" | "conflict" };

/** 입력 URL이 만든 원문만 revision 일치 시 수정하고 기존 번역을 원자적으로 지운다. */
export function editMessage(input: {
  pageId: string;
  messageId: number;
  body: string;
  revision: number;
}): EditMessageResult {
  return transaction(() => {
    const row = parseSqlRow(
      messageRowSchema.extend({ meeting_status: meetingStatusSchema }),
      getDb().prepare(
        `SELECT m.*, mt.status AS meeting_status
         FROM messages m
         JOIN meetings mt ON mt.id = m.meeting_id
         WHERE m.id = ? AND m.page_id = ?`,
      ).get(input.messageId, input.pageId),
      "수정할 원문",
    );
    if (!row) return { ok: false, reason: "not-found" };
    if (row.meeting_status !== "open") return { ok: false, reason: "closed" };
    if (row.revision !== input.revision) return { ok: false, reason: "conflict" };

    const editedAt = Date.now();
    const revision = row.revision + 1;
    const updated = getDb().prepare(
      `UPDATE messages SET body = ?, revision = ?, edited_at = ?
       WHERE id = ? AND page_id = ? AND revision = ?`,
    ).run(input.body, revision, editedAt, row.id, input.pageId, row.revision);
    if (updated.changes === 0) return { ok: false, reason: "conflict" };
    getDb().prepare(`DELETE FROM translations WHERE message_id = ?`).run(row.id);

    return {
      ok: true,
      message: {
        id: row.id,
        meetingId: row.meeting_id,
        pageId: row.page_id,
        lang: row.lang,
        body: input.body,
        speakerName: row.speaker_name,
        revision,
        editedAt,
        createdAt: row.created_at,
      },
    };
  });
}

export type OutputEntry = {
  messageId: number;
  body: string;
  speakerName: string | null;
  status: "ok" | "error";
  error: string | null;
  revision: number;
  editedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** 대상 언어 번역과 같은 언어 원문을 하나의 참석자 타임라인으로 읽는다. */
export function getRecentOutput(
  meetingId: string,
  lang: LanguageCode,
  limit = 200,
): OutputEntry[] {
  const rows = parseSqlRows(
    outputRowSchema,
    getDb().prepare(
      `SELECT message_id, body, speaker_name, status, error, revision, edited_at, created_at, updated_at FROM (
         SELECT m.id AS message_id, m.body, m.speaker_name, 'ok' AS status, NULL AS error,
                m.revision, m.edited_at, m.created_at,
                COALESCE(m.edited_at, m.created_at) AS updated_at
         FROM messages m WHERE m.meeting_id = ? AND m.lang = ?
         UNION ALL
         SELECT t.message_id, t.body, m.speaker_name, t.status, t.error,
                m.revision, m.edited_at, m.created_at,
                MAX(COALESCE(m.edited_at, m.created_at), t.created_at) AS updated_at
         FROM translations t
         JOIN messages m ON m.id = t.message_id
         WHERE m.meeting_id = ? AND t.lang = ?
       ) ORDER BY message_id DESC LIMIT ?`,
    ).all(meetingId, lang, meetingId, lang, limit),
    "출력 이력",
  );

  return rows.reverse().map((row) => ({
    messageId: row.message_id,
    body: row.body,
    speakerName: row.speaker_name,
    status: row.status,
    error: row.error,
    revision: row.revision,
    editedAt: row.edited_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * 번역 결과를 저장한다.
 *
 * 같은 (메시지, 언어) 조합이 다시 들어오면 덮어쓴다 — 실패한 번역을 재시도했을 때
 * 로그에 실패 줄과 성공 줄이 나란히 남지 않게 하기 위해서다.
 */
export function upsertTranslation(input: {
  messageId: number;
  revision: number;
  lang: LanguageCode;
  body: string;
  engine: string;
  status: "ok" | "error";
  error?: string | null;
}): number | null {
  const now = Date.now();
  const current = parseSqlRow(
    messageRowSchema.pick({ revision: true }),
    getDb().prepare(`SELECT revision FROM messages WHERE id = ?`).get(input.messageId),
    "번역 대상 revision",
  );
  if (!current || current.revision !== input.revision) return null;

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
export function getRecentMessages(meetingId: string, limit: number | null = 200): Message[] {
  const rawRows = limit === null
    ? getDb().prepare(`SELECT * FROM messages WHERE meeting_id = ? ORDER BY id`).all(meetingId)
    : getDb()
        .prepare(`SELECT * FROM messages WHERE meeting_id = ? ORDER BY id DESC LIMIT ?`)
        .all(meetingId, limit);
  const rows = parseSqlRows(messageRowSchema, rawRows, "원문 이력");

  if (limit !== null) rows.reverse();

  return rows.map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    pageId: row.page_id,
    lang: row.lang,
    body: row.body,
    speakerName: row.speaker_name,
    revision: row.revision,
    editedAt: row.edited_at,
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
): (Translation & { sourceLang: LanguageCode; sourceBody: string; speakerName: string | null })[] {
  const rows = parseSqlRows(
    recentTranslationRowSchema,
    getDb().prepare(
      `SELECT t.*, m.lang AS source_lang, m.body AS source_body, m.speaker_name
       FROM translations t
       JOIN messages m ON m.id = t.message_id
       WHERE m.meeting_id = ? AND t.lang = ?
       ORDER BY t.message_id DESC
       LIMIT ?`,
    ).all(meetingId, lang, limit),
    "번역 이력",
  );

  return rows.reverse().map((row) => ({
    id: row.id,
    messageId: row.message_id,
    lang: row.lang,
    body: row.body,
    engine: row.engine,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    sourceLang: row.source_lang,
    sourceBody: row.source_body,
    speakerName: row.speaker_name,
  }));
}

/** 페이지 헤더의 "입력/출력 상태"에 쓰는 요약 */
export type MeetingActivity = {
  messageCount: number;
  translationCount: number;
  lastMessageAt: number | null;
  lastTranslationAt: number | null;
  failedTranslationCount: number;
};

export function getMeetingActivity(meetingId: string): MeetingActivity {
  const messages = parseRequiredSqlRow(
    messageCountRowSchema,
    getDb().prepare(
      `SELECT COUNT(*) AS c, MAX(created_at) AS last FROM messages WHERE meeting_id = ?`,
    ).get(meetingId),
    "원문 활동 요약",
  );

  const translations = parseRequiredSqlRow(
    translationCountRowSchema,
    getDb().prepare(
      `SELECT COUNT(*) AS c,
              MAX(t.created_at) AS last,
              SUM(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END) AS failed
       FROM translations t
       JOIN messages m ON m.id = t.message_id
       WHERE m.meeting_id = ?`,
    ).get(meetingId),
    "번역 활동 요약",
  );

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
  const messages = parseSqlRows(
    logMessageRowSchema,
    getDb().prepare(
      `SELECT id, lang, body, speaker_name, revision, edited_at, created_at FROM messages
       WHERE meeting_id = ? ORDER BY id`,
    ).all(meetingId),
    "로그 원문",
  );

  const translations = parseSqlRows(
    logTranslationRowSchema,
    getDb().prepare(
      `SELECT t.message_id, t.lang, t.body, t.status, m.revision, m.edited_at, t.created_at
       FROM translations t
       JOIN messages m ON m.id = t.message_id
       WHERE m.meeting_id = ? AND t.status = 'ok'
       ORDER BY t.message_id, t.lang`,
    ).all(meetingId),
    "로그 번역",
  );

  const byMessage = new Map<number, typeof translations>();
  for (const row of translations) {
    const bucket = byMessage.get(row.message_id);
    if (bucket) bucket.push(row);
    else byMessage.set(row.message_id, [row]);
  }

  const wanted = langs?.length ? new Set(langs) : null;
  const lines: LogLine[] = [];

  for (const message of messages) {
    const sourceLang = message.lang;
    if (!wanted || wanted.has(sourceLang)) {
      lines.push({
        messageId: message.id,
        revision: message.revision,
        editedAt: message.edited_at,
        at: message.created_at,
        lang: sourceLang,
        kind: "source",
        body: message.body,
        speakerName: message.speaker_name,
        text: formatSourceLine(message.created_at, message.body, message.speaker_name),
      });
    }

    for (const translation of byMessage.get(message.id) ?? []) {
      const lang = translation.lang;
      if (wanted && !wanted.has(lang)) continue;
      lines.push({
        messageId: message.id,
        revision: translation.revision,
        editedAt: translation.edited_at,
        at: translation.created_at,
        lang,
        kind: "translation",
        body: translation.body,
        speakerName: message.speaker_name,
        text: formatTranslationLine(
          translation.created_at,
          lang,
          translation.body,
          message.speaker_name,
        ),
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
  const rows = parseSqlRows(
    bodyRowSchema,
    getDb().prepare(
      `SELECT body FROM messages
       WHERE meeting_id = ? AND id < ?
       ORDER BY id DESC LIMIT ?`,
    ).all(meetingId, beforeMessageId, limit),
    "번역 문맥 원문",
  );

  return rows.reverse().map((row) => row.body);
}

/** 통합 보기 페이지가 처음 열릴 때 채울 이력: 원문 + 그 원문의 모든 번역 */
export type CombinedEntry = {
  messageId: number;
  sourceLang: LanguageCode;
  sourceBody: string;
  speakerName: string | null;
  pageId: string | null;
  revision: number;
  editedAt: number | null;
  createdAt: number;
  updatedAt: number;
  translations: {
    lang: LanguageCode;
    body: string;
    status: "ok" | "error";
    error: string | null;
  }[];
};

export function getRecentCombined(meetingId: string, limit: number | null = null): CombinedEntry[] {
  const messages = getRecentMessages(meetingId, limit);
  if (messages.length === 0) return [];

  // 메시지 목록이 정해진 뒤 번역을 한 번에 가져온다. 메시지마다 조회하면 N+1 이 된다.
  const placeholders = messages.map(() => "?").join(",");
  const rows = parseSqlRows(
    combinedTranslationRowSchema,
    getDb().prepare(
      `SELECT message_id, lang, body, status, error, created_at FROM translations
       WHERE message_id IN (${placeholders})
       ORDER BY message_id, lang`,
    ).all(...messages.map((message) => message.id)),
    "통합 조회 번역",
  );

  const byMessage = new Map<number, CombinedEntry["translations"]>();
  const translatedAt = new Map<number, number>();
  for (const row of rows) {
    const entry = {
      lang: row.lang,
      body: row.body,
      status: row.status,
      error: row.error,
    };
    const bucket = byMessage.get(row.message_id);
    if (bucket) bucket.push(entry);
    else byMessage.set(row.message_id, [entry]);
    translatedAt.set(row.message_id, Math.max(translatedAt.get(row.message_id) ?? 0, row.created_at));
  }

  return messages.map((message) => ({
    messageId: message.id,
    sourceLang: message.lang,
    sourceBody: message.body,
    speakerName: message.speakerName,
    pageId: message.pageId,
    revision: message.revision,
    editedAt: message.editedAt,
    createdAt: message.createdAt,
    updatedAt: Math.max(message.editedAt ?? message.createdAt, translatedAt.get(message.id) ?? 0),
    translations: byMessage.get(message.id) ?? [],
  }));
}

// ---------------------------------------------------------- 엔진 API 키

/**
 * 저장된 번역 엔진·OpenAI Usage API 자격 증명.
 *
 * `secret` 은 암호문이다. 이 계층은 복호화하지 않는다 — 암호화 규칙은
 * `lib/crypto.ts` 에, 어떤 키를 쓸지 고르는 규칙은 `lib/secrets.ts` 에 둔다.
 */
export type EngineSecret = {
  engine: StoredSecretId;
  secret: Uint8Array;
  hint: string;
  updatedAt: number;
};

/** 화면에 내려도 되는 부분만. 암호문이 라우트 밖으로 새지 않게 분리해 둔다. */
export type EngineSecretInfo = {
  engine: StoredSecretId;
  hint: string;
  updatedAt: number;
};

export function upsertEngineSecret(input: {
  engine: StoredSecretId;
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

export function getEngineSecret(engine: StoredSecretId): EngineSecret | null {
  const row = parseSqlRow(
    engineSecretRowSchema,
    getDb()
      .prepare(`SELECT engine, secret, hint, updated_at FROM engine_secrets WHERE engine = ?`)
      .get(engine),
    "번역 엔진 비밀키",
  );

  if (!row) return null;

  return {
    engine: row.engine,
    secret: row.secret,
    hint: row.hint,
    updatedAt: row.updated_at,
  };
}

export function listEngineSecrets(): EngineSecretInfo[] {
  const rows = parseSqlRows(
    engineSecretInfoRowSchema,
    getDb().prepare(`SELECT engine, hint, updated_at FROM engine_secrets ORDER BY engine`).all(),
    "번역 엔진 비밀키 목록",
  );

  return rows.map((row) => ({
    engine: row.engine,
    hint: row.hint,
    updatedAt: row.updated_at,
  }));
}

export function deleteEngineSecret(engine: StoredSecretId): void {
  getDb().prepare(`DELETE FROM engine_secrets WHERE engine = ?`).run(engine);
}

// ---------------------------------------------------------- 언어

export type LanguageRow = {
  code: LanguageCode;
  position: number;
  addedAt: number;
};

/** 등록된 언어. **화면과 API 는 언제나 여기를 본다** — 코드 상수를 직접 읽지 않는다. */
export function listLanguages(): LanguageRow[] {
  const rows = parseSqlRows(
    languageRowSchema,
    getDb().prepare(`SELECT code, position, added_at FROM languages ORDER BY position, code`).all(),
    "언어 목록",
  );

  return rows.map((row) => ({
    code: row.code,
    position: row.position,
    addedAt: row.added_at,
  }));
}

export function hasLanguage(code: LanguageCode): boolean {
  const row = getDb().prepare(`SELECT 1 FROM languages WHERE code = ?`).get(code);
  return Boolean(row);
}

/** 목록 맨 뒤에 붙인다. 이미 있으면 아무 일도 하지 않는다. */
export function addLanguage(code: LanguageCode): void {
  const db = getDb();
  const max = parseRequiredSqlRow(
    maxPositionRowSchema,
    db.prepare(`SELECT MAX(position) AS max FROM languages`).get(),
    "언어 최대 위치",
  );

  db.prepare(`INSERT OR IGNORE INTO languages (code, position, added_at) VALUES (?, ?, ?)`).run(
    code,
    (max.max ?? -1) + 1,
    Date.now(),
  );
}

/** `ui_strings` 는 외래키 CASCADE 로 함께 지워진다. */
export function deleteLanguage(code: LanguageCode): void {
  getDb().prepare(`DELETE FROM languages WHERE code = ?`).run(code);
}

/**
 * 회의에서 쓰인 적이 있는 언어인지.
 *
 * 쓰인 언어를 지우면 그 회의의 페이지·번역·로그가 이름 없는 코드만 남긴다.
 * 지난 회의 기록을 깨뜨리지 않기 위한 가드다.
 */
export function isLanguageUsed(code: LanguageCode): boolean {
  const row = getDb().prepare(`SELECT 1 FROM meeting_langs WHERE lang = ? LIMIT 1`).get(code);
  return Boolean(row) || listSessionPresets().some((preset) =>
    preset.languages.some((language) => language.lang === code),
  );
}

// ---------------------------------------------------------- UI 문구

export type UiStringOrigin = "machine" | "manual";

export type UiStringRow = {
  key: string;
  text: string;
  origin: UiStringOrigin;
};

/** 한 언어의 UI 문구 오버레이. 빌트인 언어는 대개 비어 있다. */
export function getUiStrings(lang: LanguageCode): UiStringRow[] {
  const rows = parseSqlRows(
    uiStringRowSchema,
    getDb().prepare(`SELECT key, text, origin FROM ui_strings WHERE lang = ?`).all(lang),
    "UI 문구",
  );

  return rows.map((row) => ({
    key: row.key,
    text: row.text,
    origin: row.origin,
  }));
}

/**
 * 문구를 넣거나 덮어쓴다.
 *
 * 한 언어의 문구 수십 개가 한 번에 들어오므로 트랜잭션으로 묶는다. 중간에
 * 실패해서 절반만 반영되면 화면이 두 언어로 섞인다.
 */
export function upsertUiStrings(
  lang: LanguageCode,
  entries: readonly { key: string; text: string; origin: UiStringOrigin }[],
): void {
  if (entries.length === 0) return;

  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO ui_strings (lang, key, text, origin)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (lang, key) DO UPDATE SET
       text = excluded.text,
       origin = excluded.origin`,
  );

  db.exec("BEGIN");
  try {
    for (const entry of entries) {
      statement.run(lang, entry.key, entry.text, entry.origin);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 되돌리기. 행을 지우면 빌트인 문구(없으면 한국어)로 떨어진다. */
export function deleteUiString(lang: LanguageCode, key: string): void {
  getDb().prepare(`DELETE FROM ui_strings WHERE lang = ? AND key = ?`).run(lang, key);
}

// ---------------------------------------------------------- 단어집

export type GlossaryEntry = {
  id: string;
  terms: Record<LanguageCode, string>;
  createdAt: number;
  updatedAt: number;
};

export type GlossaryPair = { source: string; target: string };

export function listGlossaryEntries(): GlossaryEntry[] {
  const entries = parseSqlRows(
    glossaryEntryRowSchema,
    getDb()
      .prepare(`SELECT id, created_at, updated_at FROM glossary_entries ORDER BY created_at, id`)
      .all(),
    "단어집 항목",
  );
  const terms = parseSqlRows(
    glossaryTermRowSchema,
    getDb()
      .prepare(`SELECT entry_id, lang, term FROM glossary_terms ORDER BY entry_id, lang`)
      .all(),
    "단어집 번역어",
  );
  const byEntry = new Map<string, Record<LanguageCode, string>>();

  for (const row of terms) {
    const current = byEntry.get(row.entry_id) ?? {};
    current[row.lang] = row.term;
    byEntry.set(row.entry_id, current);
  }

  return entries.map((entry) => ({
    id: entry.id,
    terms: byEntry.get(entry.id) ?? {},
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  }));
}

/** 관리 화면에서 보낸 전체 단어집을 한 번에 교체한다. */
export function replaceGlossaryEntries(
  entries: readonly { id?: string; terms: Readonly<Record<LanguageCode, string>> }[],
): GlossaryEntry[] {
  const db = getDb();
  const existing = new Map(listGlossaryEntries().map((entry) => [entry.id, entry]));
  const insertEntry = db.prepare(
    `INSERT INTO glossary_entries (id, created_at, updated_at) VALUES (?, ?, ?)`,
  );
  const insertTerm = db.prepare(
    `INSERT INTO glossary_terms (entry_id, lang, term) VALUES (?, ?, ?)`,
  );
  const now = Date.now();

  transaction(() => {
    db.prepare(`DELETE FROM glossary_entries`).run();
    for (const entry of entries) {
      const id = entry.id && existing.has(entry.id) ? entry.id : newId();
      insertEntry.run(id, existing.get(id)?.createdAt ?? now, now);
      for (const [lang, term] of Object.entries(entry.terms)) {
        insertTerm.run(id, lang, term.trim());
      }
    }
  });

  return listGlossaryEntries();
}

/** 회의 번역에서 현재 원문/대상 언어에 해당하는 용어쌍만 꺼낸다. */
export function listGlossaryPairs(from: LanguageCode, to: LanguageCode): GlossaryPair[] {
  const rows = parseSqlRows(
    glossaryPairRowSchema,
    getDb().prepare(
      `SELECT source.term AS source, target.term AS target
       FROM glossary_terms source
       JOIN glossary_terms target ON target.entry_id = source.entry_id
       JOIN glossary_entries entry ON entry.id = source.entry_id
       WHERE source.lang = ? AND target.lang = ?
       ORDER BY entry.created_at, entry.id`,
    ).all(from, to),
    "번역 단어집",
  );

  return rows.filter((row) => row.source.trim() && row.target.trim());
}

// ---------------------------------------------------------- 번역 프롬프트 문체 지시문

export type LanguagePromptCue = {
  text: string;
  engine: EngineId;
  updatedAt: number;
};

export function getLanguagePromptCue(lang: LanguageCode): LanguagePromptCue | null {
  const row = parseSqlRow(
    promptCueRowSchema,
    getDb()
      .prepare(`SELECT text, engine, updated_at FROM language_prompt_cues WHERE lang = ?`)
      .get(lang),
    "언어별 번역 지시문",
  );

  return row ? { text: row.text, engine: row.engine, updatedAt: row.updated_at } : null;
}

export function upsertLanguagePromptCue(
  lang: LanguageCode,
  text: string,
  engine: EngineId,
): void {
  getDb()
    .prepare(
      `INSERT INTO language_prompt_cues (lang, text, engine, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (lang) DO UPDATE SET
         text = excluded.text,
         engine = excluded.engine,
         updated_at = excluded.updated_at`,
    )
    .run(lang, text, engine, Date.now());
}

// ---------------------------------------------------------- 엔진 설정

export type EngineSetting = {
  engine: EngineId;
  model: string | null;
  updatedAt: number;
};

export function getEngineSetting(engine: EngineId): EngineSetting | null {
  const row = parseSqlRow(
    engineSettingRowSchema,
    getDb()
      .prepare(`SELECT engine, model, updated_at FROM engine_settings WHERE engine = ?`)
      .get(engine),
    "번역 엔진 설정",
  );

  if (!row) return null;

  return {
    engine: row.engine,
    model: row.model,
    updatedAt: row.updated_at,
  };
}

/** 관리자 화면에서 마지막으로 고른 번역 엔진. */
export function getLastEngineSetting(): EngineSetting | null {
  const row = parseSqlRow(
    engineSettingRowSchema,
    getDb().prepare(
      `SELECT engine, model, updated_at FROM engine_settings
       WHERE engine IN ('google', 'deepl', 'openai', 'local')
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(),
    "마지막 번역 엔진 설정",
  );

  return row
    ? { engine: row.engine, model: row.model, updatedAt: row.updated_at }
    : null;
}

/** 엔진 선택 시각만 갱신한다. OpenAI 모델은 그대로 보존한다. */
export function touchEngineSetting(engine: EngineId): void {
  getDb()
    .prepare(
      `INSERT INTO engine_settings (engine, model, updated_at)
       VALUES (?, NULL, ?)
       ON CONFLICT (engine) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(engine, Date.now());
}

/** `model` 이 null 이면 내장 기본 모델을 쓴다는 뜻이다. */
export function upsertEngineSetting(engine: EngineId, model: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO engine_settings (engine, model, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (engine) DO UPDATE SET
         model = excluded.model,
         updated_at = excluded.updated_at`,
    )
    .run(engine, model, Date.now());
}

/** 관리자 화면에서 마지막으로 고른 음성 인식 엔진. */
export function getTranscriptionProviderSetting(): TranscriptionProvider | null {
  const row = parseSqlRow(
    transcriptionSettingRowSchema,
    getDb().prepare(`SELECT model FROM engine_settings WHERE engine = 'transcription'`).get(),
    "음성 인식 엔진 설정",
  );
  return row?.model ?? null;
}

export function upsertTranscriptionProviderSetting(provider: TranscriptionProvider): void {
  getDb()
    .prepare(
      `INSERT INTO engine_settings (engine, model, updated_at)
       VALUES ('transcription', ?, ?)
       ON CONFLICT (engine) DO UPDATE SET
         model = excluded.model,
         updated_at = excluded.updated_at`,
    )
    .run(provider, Date.now());
}

/* ── OpenAI 모델 목록 캐시 ─────────────────────────────────── */

/** 마지막으로 조회한 모델 목록. 없으면 빈 배열이다. */
export function listOpenaiModels(): string[] {
  const rows = parseSqlRows(
    openaiModelRowSchema,
    getDb().prepare(`SELECT model FROM openai_models ORDER BY position`).all(),
    "OpenAI 모델 캐시",
  );

  return rows.map((row) => row.model);
}

/**
 * 캐시를 통째로 갈아 끼운다.
 *
 * 계정에서 모델이 사라지는 일도 있으므로 병합이 아니라 교체다. 빈 목록으로는
 * 덮지 않는다 — 조회 실패를 "모델이 하나도 없음" 으로 기록하면 화면이 비어 버린다.
 */
export function replaceOpenaiModels(models: readonly string[]): void {
  if (models.length === 0) return;

  const db = getDb();
  const now = Date.now();

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM openai_models`).run();
    const insert = db.prepare(
      `INSERT INTO openai_models (model, position, fetched_at) VALUES (?, ?, ?)`,
    );
    models.forEach((model, index) => {
      insert.run(model, index, now);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
