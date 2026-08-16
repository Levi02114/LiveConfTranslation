import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import type { LanguageCode } from "@/lib/languages";
import { engineKey } from "@/lib/secrets";
import {
  createMeeting,
  hasLanguage,
  listLanguages,
  listMeetings,
  touchEngineSetting,
} from "@/lib/repo";
import { isEngineId } from "@/lib/translate";

/*
 * 언어 검증이 상수 대조가 아니라 DB 조회다. 쓸 수 있는 언어는 관리자가 화면에서
 * 정하므로(`/api/admin/languages`) 컴파일 타임에 알 수 없다.
 */
const createSchema = z.object({
  title: z.string().trim().min(1, "세션 제목을 입력해 주세요").max(200),
  langs: z
    .array(z.string().refine(hasLanguage, "등록되지 않은 언어입니다"))
    .min(2, "최소 두 개 언어가 필요합니다")
    .optional(),
  engine: z.string().refine(isEngineId, "지원하지 않는 번역 엔진입니다").optional(),
  fallbackEngine: z
    .union([z.string().refine(isEngineId, "지원하지 않는 폴백 엔진입니다"), z.null()])
    .optional(),
  inputMode: z.enum(["human", "realtime"]).optional(),
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

  const { title, langs, engine, fallbackEngine = null, inputMode = "human" } = parsed.data;

  // 같은 언어를 두 번 고르면 페이지가 중복 생성되므로 걸러 낸다.
  const requestedLangs = langs ?? listLanguages().map((row) => row.code);
  const unique = [...new Set(requestedLangs)] as LanguageCode[];
  if (unique.length < 2) {
    return Response.json({ error: "서로 다른 언어를 두 개 이상 골라 주세요" }, { status: 400 });
  }

  if (inputMode === "realtime") {
    if (!engineKey("openai")) {
      return Response.json({ error: "AI 실시간 전사에는 OpenAI API 키가 필요합니다" }, { status: 409 });
    }
  }

  const requested = engine ?? "google";
  if (!isEngineId(requested)) {
    return Response.json(
      { error: `알 수 없는 번역 엔진입니다: ${requested}` },
      { status: 400 },
    );
  }
  if (fallbackEngine === requested) {
    return Response.json(
      { error: "폴백 엔진은 번역 엔진과 다르게 골라 주세요" },
      { status: 400 },
    );
  }

  const meeting = createMeeting({
    title,
    langs: unique,
    engine: requested,
    fallbackEngine,
    inputMode,
  });
  touchEngineSetting(requested);
  revalidatePath("/admin");
  return Response.json({ meeting }, { status: 201 });
}
