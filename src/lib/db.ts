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

import { databasePath } from "@/lib/env";

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
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS meeting_langs (
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, lang)
);

CREATE TABLE IF NOT EXISTS pages (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- 'input' | 'output'
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
  engine      TEXT PRIMARY KEY,               -- 'google' | 'deepl' | 'openai'
  -- AES-256-GCM 암호문(iv || tag || ciphertext). 평문 키는 저장하지 않는다.
  secret      BLOB NOT NULL,
  -- 관리자가 어떤 키인지 알아볼 수 있게 하는 마스킹 문자열. 복호화 없이 읽는다.
  hint        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_meeting ON messages (meeting_id, id);
CREATE INDEX IF NOT EXISTS idx_translations_message ON translations (message_id);
CREATE INDEX IF NOT EXISTS idx_pages_meeting ON pages (meeting_id);
`;

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

  return db;
}

const globalForDb = globalThis as unknown as { __meetingDb?: DatabaseSync };

/** 연결을 얻는다. 첫 호출에서 파일을 열고 스키마를 만든다. */
export function getDb(): DatabaseSync {
  return (globalForDb.__meetingDb ??= open());
}
