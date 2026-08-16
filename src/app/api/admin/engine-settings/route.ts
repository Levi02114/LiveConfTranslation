import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { getEngineSetting, touchEngineSetting, upsertEngineSetting } from "@/lib/repo";
import { ENGINE_IDS, isEngineId } from "@/lib/translate";

/**
 * 엔진별 설정. 지금은 OpenAI 언어모델 하나뿐이다.
 *
 * API 키(`engine-keys`)와 나눠 둔 이유는 비밀이 아니기 때문이다. 키는 암호화해
 * 저장하고 절대 되돌려 주지 않지만, 모델 이름은 화면에 그대로 보여야 한다.
 *
 * **전역 설정이다.** 회의마다 다른 모델을 쓰지 않는다.
 */

const saveSchema = z.object({
  engine: z.string().refine(isEngineId, "지원하지 않는 번역 엔진입니다"),
  // 생략하면 엔진 선택 시각만, 빈 문자열/null이면 내장 기본 모델을 쓴다.
  model: z.string().trim().max(100).nullable().optional(),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  return Response.json({
    settings: ENGINE_IDS.map((engine) => ({
      engine,
      model: getEngineSetting(engine)?.model ?? null,
    })),
  });
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

  const { engine, model } = parsed.data;
  if (model === undefined) touchEngineSetting(engine);
  else upsertEngineSetting(engine, model || null);

  return Response.json({ engine, model: getEngineSetting(engine)?.model ?? null });
}
