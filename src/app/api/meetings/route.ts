import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { defaultEngine } from "@/lib/env";
import { DEFAULT_LANGUAGES, isLanguageCode, type LanguageCode } from "@/lib/languages";
import { createMeeting, listMeetings } from "@/lib/repo";
import { isEngineId } from "@/lib/translate";

const createSchema = z.object({
  title: z.string().trim().min(1, "회의 제목을 입력해 주세요").max(200),
  langs: z
    .array(z.string().refine(isLanguageCode, "지원하지 않는 언어입니다"))
    .min(2, "최소 두 개 언어가 필요합니다")
    .default([...DEFAULT_LANGUAGES]),
  engine: z.string().refine(isEngineId, "지원하지 않는 번역 엔진입니다").optional(),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  return Response.json({ meetings: listMeetings() });
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "요청이 올바르지 않습니다", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { title, langs, engine } = parsed.data;

  // 같은 언어를 두 번 고르면 페이지가 중복 생성되므로 걸러 낸다.
  const unique = [...new Set(langs)] as LanguageCode[];
  if (unique.length < 2) {
    return Response.json({ error: "서로 다른 언어를 두 개 이상 골라 주세요" }, { status: 400 });
  }

  const requested = engine ?? defaultEngine();
  if (!isEngineId(requested)) {
    return Response.json(
      { error: `알 수 없는 번역 엔진입니다: ${requested}` },
      { status: 400 },
    );
  }

  const meeting = createMeeting({ title, langs: unique, engine: requested });
  return Response.json({ meeting }, { status: 201 });
}
