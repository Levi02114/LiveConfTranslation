/*
 * 이 모듈에는 `server-only` 를 걸지 않는다.
 *
 * 커스텀 서버(`server.ts`)가 Next 번들러를 거치지 않고 직접 불러오는데,
 * `server-only` 는 번들러 밖에서 로드되면 무조건 던지도록 만들어진 패키지다.
 *
 * 대신 이 파일은 node: 내장 모듈에 의존하므로, 클라이언트 컴포넌트에서 잘못
 * 불러오면 번들 단계에서 바로 실패한다 — 보호는 그대로 유지된다.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { databasePath } from "@/lib/env";
import { newId, newPageToken } from "@/lib/ids";
import { BUILTIN_LANGUAGES } from "@/lib/languages";
import { parseSqlRows } from "@/lib/sqlite-schema";

declare global {
  var __meetingDb: DatabaseSync | undefined;
}

const missingCaptureRowSchema = z.object({ meeting_id: z.string(), lang: z.string() });
const columnRowSchema = z.object({ name: z.string() });

/**
 * SQLite 연결.
 *
 * `node:sqlite` 는 Node 22.13.0 부터 플래그 없이 쓸 수 있는 내장 모듈이다.
 * 네이티브 의존성이 없어 자체 호스팅 환경에서 빌드 도구 문제가 생기지 않는다.
 *
 * 연결은 **처음 질의할 때** 연다. 모듈을 불러오는 것만으로 열면 `next build` 가
 * 라우트 설정을 모으느라 여러 워커로 모듈을 평가할 때 워커마다 DB 를 붙잡아
 * 서로 잠금을 건다. 빌드는 DB 를 건드릴 이유가 없다.
 *
 * 개발 중 핫 리로드가 모듈을 다시 평가해도 연결이 새로 열리지 않도록
 * `globalThis` 에 물려 프로세스당 하나만 유지한다.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meetings (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
  engine      TEXT NOT NULL DEFAULT 'google', -- 회의 개설 시 고른 번역 엔진
  fallback_engine TEXT,                       -- 선택 폴백 엔진. NULL 이면 폴백 없음
  input_mode  TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'realtime'
  source_lang TEXT,                           -- 이전 단일 원음 모드 호환용(신규 데이터는 NULL)
  speaker_labels INTEGER NOT NULL DEFAULT 0,  -- 입력자 닉네임을 확정 기록에 남길지
  translation_model TEXT,                    -- 세션 생성 시 확정한 번역 모델
  transcription_provider TEXT NOT NULL DEFAULT 'openai', -- 'openai' | 'google' | 'local'
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS meeting_langs (
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  input_enabled INTEGER NOT NULL DEFAULT 1,
  output_enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (meeting_id, lang)
);

CREATE TABLE IF NOT EXISTS pages (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- 'input' | 'output' | 'combined' | 'combined-input' | 'capture'
  lang        TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,           -- URL 에 노출되는 접근 토큰
  created_at  INTEGER NOT NULL,
  UNIQUE (meeting_id, kind, lang)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  page_id     TEXT REFERENCES pages(id) ON DELETE SET NULL,
  lang        TEXT NOT NULL,                  -- 원문 언어
  body        TEXT NOT NULL,
  speaker_name TEXT,                          -- 닉네임 기능을 쓰지 않으면 NULL
  ingest_key  TEXT,                           -- AI 전사 재전송 멱등 키
  revision    INTEGER NOT NULL DEFAULT 0,     -- 원문 수정 시 증가하는 낙관적 잠금 번호
  edited_at   INTEGER,                        -- 한 번이라도 수정했으면 마지막 수정 시각
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS translations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  body        TEXT NOT NULL,
  engine      TEXT NOT NULL,                  -- 폴백될 수 있으므로 '실제로 쓴' 엔진을 남긴다
  status      TEXT NOT NULL,                  -- 'ok' | 'error'
  error       TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (message_id, lang)
);

CREATE TABLE IF NOT EXISTS engine_secrets (
  engine      TEXT PRIMARY KEY,               -- 번역 엔진 또는 'openai-admin' Usage 자격 증명
  -- AES-256-GCM 암호문(iv || tag || ciphertext). 평문 키는 저장하지 않는다.
  secret      BLOB NOT NULL,
  -- 관리자가 어떤 키인지 알아볼 수 있게 하는 마스킹 문자열. 복호화 없이 읽는다.
  hint        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS languages (
  code        TEXT PRIMARY KEY,               -- BCP-47. 'ko', 'zh-CN' ...
  position    INTEGER NOT NULL,               -- 화면에 나열하는 순서
  added_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ui_strings (
  lang        TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  key         TEXT NOT NULL,                  -- 'list.heading' 같은 점 경로
  text        TEXT NOT NULL,
  -- 'machine' 은 엔진이 번역한 것, 'manual' 은 관리자가 고친 것.
  -- 「다시 번역」이 사람이 고친 문구를 덮어쓰지 않게 하려고 구분한다.
  origin      TEXT NOT NULL,
  PRIMARY KEY (lang, key)
);

CREATE TABLE IF NOT EXISTS language_prompt_cues (
  lang        TEXT PRIMARY KEY REFERENCES languages(code) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  engine      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary_entries (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary_terms (
  entry_id    TEXT NOT NULL REFERENCES glossary_entries(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  term        TEXT NOT NULL,
  PRIMARY KEY (entry_id, lang)
);

CREATE TABLE IF NOT EXISTS engine_settings (
  engine      TEXT PRIMARY KEY,               -- 번역 엔진 또는 'transcription'
  model       TEXT,                           -- 모델 또는 마지막 음성 인식 엔진
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_presets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  config_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 계정에서 쓸 수 있는 OpenAI 모델 목록 캐시.
--
-- 관리 화면을 열 때마다 다시 물어보지만, 응답을 기다리는 동안 빈 드롭다운을
-- 보여 줄 수는 없다. 지난번 목록을 여기서 꺼내 바로 그리고, 응답이 오면 갈아 끼운다.
-- 키가 없거나 네트워크가 없으면 이 캐시가 그대로 최종 목록이 된다.
CREATE TABLE IF NOT EXISTS openai_models (
  model       TEXT PRIMARY KEY,
  position    INTEGER NOT NULL,               -- 조회 시점의 순서를 보존한다
  fetched_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_meeting ON messages (meeting_id, id);
CREATE INDEX IF NOT EXISTS idx_translations_message ON translations (message_id);
CREATE INDEX IF NOT EXISTS idx_pages_meeting ON pages (meeting_id);
CREATE INDEX IF NOT EXISTS idx_glossary_terms_lang ON glossary_terms (lang, entry_id);
`;

/**
 * 기본 언어 네 개를 `languages` 에 심는다.
 *
 * 목록을 읽는 곳이 **DB 한 군데뿐이게** 하려는 것이다. "빌트인은 상수에서,
 * 추가한 것은 DB 에서" 로 갈라 두면 순서와 중복을 두 곳에서 맞춰야 하고 반드시
 * 어긋난다. 이미 있으면 건드리지 않으므로 순서를 바꿔 놔도 유지된다.
 */
function seedLanguages(db: DatabaseSync): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO languages (code, position, added_at) VALUES (?, ?, ?)",
  );
  const now = Date.now();
  BUILTIN_LANGUAGES.forEach((code, index) => {
    insert.run(code, index, now);
  });
}

/** 이전 단일 원음 세션에도 선택된 모든 언어의 수집 페이지를 채운다. */
function backfillRealtimeCapturePages(db: DatabaseSync): void {
  const missing = parseSqlRows(
    missingCaptureRowSchema,
    db.prepare(
      `SELECT m.id AS meeting_id, ml.lang
       FROM meetings m
       JOIN meeting_langs ml ON ml.meeting_id = m.id
       LEFT JOIN pages p
         ON p.meeting_id = m.id AND p.kind = 'capture' AND p.lang = ml.lang
       WHERE m.input_mode = 'realtime' AND p.id IS NULL`,
    ).all(),
    "실시간 수집 페이지 마이그레이션",
  );
  const insert = db.prepare(
    `INSERT INTO pages (id, meeting_id, kind, lang, token, created_at)
     VALUES (?, ?, 'capture', ?, ?, ?)`,
  );
  const now = Date.now();
  for (const row of missing) {
    insert.run(newId(), row.meeting_id, row.lang, newPageToken(), now);
  }
}

/** 기존 개발 DB에도 새 nullable/default 컬럼을 파괴 없이 더한다. */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = parseSqlRows(
    columnRowSchema,
    db.prepare(`PRAGMA table_info(${table})`).all(),
    `${table} 테이블 정보`,
  );
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function open(): DatabaseSync {
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);

  // busy_timeout 을 가장 먼저 건다. 다른 연결이 잡고 있으면 즉시 실패하는 대신
  // 기다리게 하기 위해서다 — 아래 journal_mode 전환 자체도 잠금을 필요로 한다.
  db.exec("PRAGMA busy_timeout = 5000");
  // WAL: 읽기(대시보드·출력 페이지 SSE)가 쓰기(입력 저장)를 막지 않게 한다.
  db.exec("PRAGMA journal_mode = WAL");
  // ON DELETE CASCADE 가 실제로 걸리려면 연결마다 켜 줘야 한다.
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  ensureColumn(db, "meetings", "fallback_engine", "TEXT");
  ensureColumn(db, "meetings", "input_mode", "TEXT NOT NULL DEFAULT 'human'");
  ensureColumn(db, "meetings", "source_lang", "TEXT");
  ensureColumn(db, "meetings", "speaker_labels", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "meetings", "translation_model", "TEXT");
  ensureColumn(db, "meetings", "transcription_provider", "TEXT NOT NULL DEFAULT 'openai'");
  ensureColumn(db, "meetings", "transcription_context", "TEXT");
  ensureColumn(db, "meeting_langs", "input_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "meeting_langs", "output_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "messages", "speaker_name", "TEXT");
  ensureColumn(db, "messages", "ingest_key", "TEXT");
  ensureColumn(db, "messages", "revision", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "messages", "edited_at", "INTEGER");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_ingest_key ON messages (ingest_key)");
  seedLanguages(db);
  backfillRealtimeCapturePages(db);

  return db;
}

/** 연결을 얻는다. 첫 호출에서 파일을 열고 스키마를 만든다. */
export function getDb(): DatabaseSync {
  return (globalThis.__meetingDb ??= open());
}
