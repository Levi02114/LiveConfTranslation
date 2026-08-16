import "server-only";

import {
  applyStrings,
  type AdminStrings,
  BUILTIN_ADMIN,
  BUILTIN_UI,
  FALLBACK_ADMIN,
  FALLBACK_UI,
  flattenStrings,
  type UiStrings,
} from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";
import { getUiStrings } from "@/lib/repo";

export type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";

/**
 * UI 문구 해석기.
 *
 * 언어가 런타임에 늘어나므로 문구도 코드에만 둘 수 없다. 세 층을 **키 단위로** 겹친다:
 *
 *     DB 오버레이(ui_strings)  →  코드 빌트인(i18n-builtin.ts)  →  한국어
 *
 * 키 단위인 게 중요하다. 새 언어의 문구 90여 개 중 셋을 번역하지 못해도 그 셋만
 * 한국어로 나오고 나머지는 멀쩡하다. 언어 단위로 폴백하면 하나만 실패해도 화면
 * 전체가 한국어로 돌아가 버린다.
 *
 * 값을 캐시하지 않는다. 관리자가 `⚙` 로 문구를 고치면 새로고침 한 번에 반영되어야
 * 하는데, 캐시하면 서버를 재시작해야 한다. 조회는 인덱스 하나짜리 SELECT 다.
 */

/*
 * 참석자 문구와 관리자 문구는 같은 테이블에 살면서 키 앞자리로 갈린다.
 * 지금은 최상위 키가 겹치지 않지만, 나중에 양쪽에 `close` 같은 이름이 생겨도
 * 서로를 덮지 않게 미리 갈라 둔다.
 */
const UI_PREFIX = "ui.";
const ADMIN_PREFIX = "admin.";

function loadOverlay(lang: LanguageCode, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const row of getUiStrings(lang)) {
    if (row.key.startsWith(prefix)) out[row.key.slice(prefix.length)] = row.text;
  }

  return out;
}

/**
 * 참석자 페이지(입력·출력·통합) 문구.
 *
 * ⚠️ `BUILTIN_UI[lang]` 은 타입상 `UiStrings` 지만 **런타임에는 `undefined` 가
 * 나올 수 있다.** `LanguageCode` 가 `string` 이라 `Record` 인덱싱을 컴파일러가
 * 검사하지 않는다(`noUncheckedIndexedAccess` 미설정). 폴백은 사람이 적어야 한다.
 */
export function getStrings(lang: LanguageCode): UiStrings {
  const base: UiStrings = BUILTIN_UI[lang] ?? FALLBACK_UI;
  return applyStrings(base, loadOverlay(lang, UI_PREFIX));
}

/** 관리자 화면(로그인·회의 목록) 문구. 같은 규칙을 따른다. */
export function getAdminStrings(lang: LanguageCode): AdminStrings {
  const base: AdminStrings = BUILTIN_ADMIN[lang] ?? FALLBACK_ADMIN;
  return applyStrings(base, loadOverlay(lang, ADMIN_PREFIX));
}

// ---------------------------------------------------------- 문구 목록

/** 번역·수정 대상이 되는 문구 한 줄 */
export type StringEntry = {
  /** `ui.status.waiting` 처럼 앞자리가 붙은 저장용 키 */
  key: string;
  /** 번역의 출발점이자 `⚙` 화면의 참조가 되는 한국어 원문 */
  source: string;
};

/**
 * 번역해야 할 문구 전체 목록(한국어 기준).
 *
 * 새 언어를 추가할 때 이 목록을 통째로 엔진에 넘긴다. 순서가 고정되어야
 * 배치 번역 결과를 인덱스로 되맞출 수 있으므로 정렬해서 돌려준다.
 */
export function sourceEntries(): StringEntry[] {
  const ui = flattenStrings(FALLBACK_UI);
  const admin = flattenStrings(FALLBACK_ADMIN);

  return [
    ...Object.entries(ui).map(([key, source]) => ({ key: UI_PREFIX + key, source })),
    ...Object.entries(admin).map(([key, source]) => ({ key: ADMIN_PREFIX + key, source })),
  ].sort((a, b) => a.key.localeCompare(b.key));
}

export type ResolvedEntry = StringEntry & {
  /** 지금 화면에 실제로 나오는 값 */
  text: string;
  /** 이 값이 어디서 왔는지. `⚙` 화면이 「되돌리기」를 띄울지 정하는 데 쓴다. */
  origin: "manual" | "machine" | "builtin" | "fallback";
};

/**
 * 한 언어의 문구 현황. `⚙`(문구 수정) 화면이 쓴다.
 *
 * 세 층 중 어느 층에서 온 값인지까지 알려 준다 — 관리자가 "이건 내가 고친 것",
 * "이건 기계가 옮긴 것", "이건 아직 한국어인 것"을 구분할 수 있어야 한다.
 */
export function resolveEntries(lang: LanguageCode): ResolvedEntry[] {
  const overlay = new Map(getUiStrings(lang).map((row) => [row.key, row]));
  const builtinUi = BUILTIN_UI[lang] ? flattenStrings(BUILTIN_UI[lang]) : null;
  const builtinAdmin = BUILTIN_ADMIN[lang] ? flattenStrings(BUILTIN_ADMIN[lang]) : null;

  return sourceEntries().map((entry) => {
    const stored = overlay.get(entry.key);
    if (stored) {
      return { ...entry, text: stored.text, origin: stored.origin };
    }

    const builtin = entry.key.startsWith(UI_PREFIX)
      ? builtinUi?.[entry.key.slice(UI_PREFIX.length)]
      : builtinAdmin?.[entry.key.slice(ADMIN_PREFIX.length)];

    if (typeof builtin === "string") {
      return { ...entry, text: builtin, origin: "builtin" as const };
    }

    return { ...entry, text: entry.source, origin: "fallback" as const };
  });
}
