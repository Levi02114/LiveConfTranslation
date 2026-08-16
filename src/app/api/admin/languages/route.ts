import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { isCatalogLanguage, LANGUAGE_CATALOG } from "@/lib/language-catalog";
import {
  BUILTIN_LANGUAGES,
  getLanguage,
  isBuiltinLanguage,
  isLanguageCode,
  type LanguageCode,
} from "@/lib/languages";
import {
  addLanguage,
  deleteLanguage,
  hasLanguage,
  isLanguageUsed,
  listLanguages,
} from "@/lib/repo";
import { ENGINE_IDS, getEngine, isEngineId, refreshEngineSupport } from "@/lib/translate";
import { translateUiStrings } from "@/lib/ui-translate";

/**
 * 회의에 쓸 언어 목록 관리.
 *
 * 언어를 추가하면 **그 자리에서 UI 문구까지 옮긴다.** 언어만 늘려 놓고 화면이
 * 한국어로 남으면 참석자가 읽을 수 없으므로, 둘을 한 요청으로 묶는다.
 * 로컬 네트워크라 요청이 몇십 초 걸려도 끊길 걱정이 없어 동기로 처리한다.
 */

const addSchema = z.object({
  code: z.string().trim().refine(isLanguageCode, "언어 코드 형식이 아닙니다"),
  engine: z.string().refine(isEngineId, "지원하지 않는 번역 엔진입니다"),
});

/** 화면에 그대로 뿌릴 수 있는 모양으로 만든다. 이름은 ICU 가 만들어 준다. */
function describe(code: LanguageCode, display: LanguageCode) {
  return {
    ...getLanguage(code, display),
    builtin: isBuiltinLanguage(code),
    engines: Object.fromEntries(
      ENGINE_IDS.map((id) => [id, getEngine(id).supports(code)]),
    ) as Record<string, boolean>,
  };
}

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  await refreshEngineSupport();

  const raw = new URL(request.url).searchParams.get("display");
  const display = raw && isLanguageCode(raw) ? raw : "ko";

  const registered = listLanguages().map((row) => ({
    ...describe(row.code, display),
    used: isLanguageUsed(row.code),
  }));

  const known = new Set(registered.map((item) => item.code));

  return Response.json({
    languages: registered,
    // 이미 추가한 언어는 고를 이유가 없으므로 뺀다.
    catalog: LANGUAGE_CATALOG.filter((code) => !known.has(code)).map((code) =>
      describe(code, display),
    ),
  });
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "요청이 올바르지 않습니다", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { code, engine } = parsed.data;

  if (!isCatalogLanguage(code)) {
    return Response.json(
      { error: `번역 엔진이 다루지 못하는 언어입니다: ${code}` },
      { status: 400 },
    );
  }

  if (hasLanguage(code)) {
    return Response.json({ error: "이미 추가된 언어입니다" }, { status: 409 });
  }

  addLanguage(code);

  /*
   * 번역이 실패해도 언어는 남긴다. 문구가 비면 화면이 한국어로 나올 뿐이고,
   * 관리자는 다른 엔진으로 「다시 번역」하거나 손으로 고칠 수 있다.
   * 여기서 되돌려 버리면 왜 실패했는지 확인할 기회조차 사라진다.
   */
  const result = await translateUiStrings(code, engine);

  return Response.json({ language: describe(code, "ko"), ...result }, { status: 201 });
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const code = new URL(request.url).searchParams.get("code") ?? "";

  if (isBuiltinLanguage(code)) {
    return Response.json(
      { error: `기본 언어는 제거할 수 없습니다: ${BUILTIN_LANGUAGES.join(", ")}` },
      { status: 400 },
    );
  }

  if (!hasLanguage(code)) {
    return Response.json({ error: "등록되지 않은 언어입니다" }, { status: 404 });
  }

  // 지난 회의의 페이지·번역·로그가 이 코드를 참조한다. 지우면 기록이 깨진다.
  if (isLanguageUsed(code)) {
    return Response.json(
      { error: "세션에서 쓰인 언어는 제거할 수 없습니다" },
      { status: 409 },
    );
  }

  deleteLanguage(code);
  return Response.json({ ok: true });
}
