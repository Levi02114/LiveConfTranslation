import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import {
  createMeeting,
  hasLanguage,
  listMeetings,
  touchEngineSetting,
} from "@/lib/repo";
import { sessionConfigSchema } from "@/lib/session-config";
import { localTranscriptionConfigured } from "@/lib/local-runtime";
import { transcriptionProviderSchema } from "@/lib/repo-schema";
import { resolveOpenaiModel, transcriptionProviderConfigured } from "@/lib/secrets";
import { getEngine, isEngineId } from "@/lib/translate";

/*
 * 언어 검증이 상수 대조가 아니라 DB 조회다. 쓸 수 있는 언어는 관리자가 화면에서
 * 정하므로(`/api/admin/languages`) 컴파일 타임에 알 수 없다.
 */
const createSchema = z.object({
  title: z.string().trim().min(1, "세션 제목을 입력해 주세요").max(200),
  config: sessionConfigSchema,
  engine: z.string().refine(isEngineId, "지원하지 않는 번역 엔진입니다").optional(),
  fallbackEngine: z
    .union([z.string().refine(isEngineId, "지원하지 않는 폴백 엔진입니다"), z.null()])
    .optional(),
  transcriptionProvider: transcriptionProviderSchema.optional(),
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

  const { title, config, engine, fallbackEngine = null, transcriptionProvider = "openai" } = parsed.data;
  if (config.languages.some((row) => !hasLanguage(row.lang))) {
    return Response.json({ error: "등록되지 않은 언어입니다" }, { status: 400 });
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
  if (transcriptionProvider === "local" && !localTranscriptionConfigured()) {
    return Response.json({ error: "로컬 음성 인식 모델이 설치되지 않았습니다" }, { status: 400 });
  }
  if (transcriptionProvider === "google" && !transcriptionProviderConfigured("google")) {
    return Response.json({ error: "Google Speech 서비스 계정을 등록해 주세요" }, { status: 400 });
  }

  const activeLanguages = config.languages
    .filter((row) => row.inputEnabled || row.outputEnabled)
    .map((row) => row.lang);
  const primary = getEngine(requested);
  const fallback = fallbackEngine ? getEngine(fallbackEngine) : null;
  const unsupported = activeLanguages.filter(
    (lang) => !primary.supports(lang) && !fallback?.supports(lang),
  );
  if (unsupported.length) {
    return Response.json(
      { error: `선택한 번역 엔진이 지원하지 않는 언어입니다: ${unsupported.join(", ")}` },
      { status: 400 },
    );
  }

  const meeting = createMeeting({
    title,
    config,
    engine: requested,
    fallbackEngine,
    translationModel:
      requested === "openai" || fallbackEngine === "openai" ? resolveOpenaiModel() : null,
    transcriptionProvider,
  });
  touchEngineSetting(requested);
  revalidatePath("/admin");
  return Response.json({ meeting }, { status: 201 });
}
