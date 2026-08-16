import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { resolveEntries } from "@/lib/i18n";
import { isLanguageCode } from "@/lib/languages";
import { deleteUiString, hasLanguage, upsertUiStrings } from "@/lib/repo";
import { isEngineId } from "@/lib/translate";
import { translateUiStrings } from "@/lib/ui-translate";

/**
 * UI 문구 수정.
 *
 * 기계 번역은 라벨을 문장으로 늘리거나 엉뚱한 낱말을 고르는 일이 잦다. 그걸
 * 고칠 수단이 없으면 언어 추가 기능을 실제 행사에 쓸 수 없다.
 *
 * 손으로 고친 문구는 `origin = 'manual'` 로 표시해 「다시 번역」이 덮어쓰지
 * 못하게 한다.
 */

const langParam = (request: Request) => {
  const lang = new URL(request.url).searchParams.get("lang") ?? "";
  return isLanguageCode(lang) && hasLanguage(lang) ? lang : null;
};

const saveSchema = z.object({
  lang: z.string().refine(isLanguageCode, "언어 코드 형식이 아닙니다"),
  entries: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        // 빈 문자열은 "되돌리기"가 아니라 실수다. 되돌리기는 DELETE 로 한다.
        text: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(500),
});

const retranslateSchema = z.object({
  lang: z.string().refine(isLanguageCode, "언어 코드 형식이 아닙니다"),
  engine: z.string().refine(isEngineId, "지원하지 않는 번역 엔진입니다"),
});

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const lang = langParam(request);
  if (!lang) return Response.json({ error: "등록되지 않은 언어입니다" }, { status: 404 });

  return Response.json({ lang, entries: resolveEntries(lang) });
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "요청이 올바르지 않습니다", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { lang, entries } = parsed.data;
  if (!hasLanguage(lang)) {
    return Response.json({ error: "등록되지 않은 언어입니다" }, { status: 404 });
  }

  upsertUiStrings(
    lang,
    entries.map((entry) => ({ ...entry, origin: "manual" as const })),
  );

  return Response.json({ lang, entries: resolveEntries(lang) });
}

/** 되돌리기. 행을 지우면 빌트인 문구(없으면 한국어)가 다시 보인다. */
export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(request.url);
  const lang = langParam(request);
  const key = url.searchParams.get("key") ?? "";

  if (!lang) return Response.json({ error: "등록되지 않은 언어입니다" }, { status: 404 });
  if (!key) return Response.json({ error: "문구 키가 필요합니다" }, { status: 400 });

  deleteUiString(lang, key);
  return Response.json({ lang, entries: resolveEntries(lang) });
}

/** 다시 번역. 손으로 고친 문구는 건드리지 않는다. */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = retranslateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "요청이 올바르지 않습니다", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { lang, engine } = parsed.data;
  if (!hasLanguage(lang)) {
    return Response.json({ error: "등록되지 않은 언어입니다" }, { status: 404 });
  }

  const result = await translateUiStrings(lang, engine, { keepManual: true });

  return Response.json({ lang, ...result, entries: resolveEntries(lang) });
}
