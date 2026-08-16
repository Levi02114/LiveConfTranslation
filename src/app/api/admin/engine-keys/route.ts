import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { encryptSecret, maskSecret } from "@/lib/crypto";
import { deleteEngineSecret, upsertEngineSecret } from "@/lib/repo";
import { engineKeyStatus } from "@/lib/secrets";
import { ENGINE_IDS, isEngineId } from "@/lib/translate/types";

/**
 * 번역 엔진 API 키 관리.
 *
 * **평문 키는 어떤 응답에도 담기지 않는다.** 저장 여부와 마스킹된 힌트만 나간다.
 * 한 번 넣은 키를 화면에서 다시 꺼내 볼 수는 없고, 새로 덮어쓰기만 된다.
 */

const saveSchema = z.object({
  engine: z.string().refine(isEngineId, "지원하지 않는 번역 엔진입니다"),
  // 붙여넣기에 딸려 오는 공백·개행은 그대로 두면 인증이 실패한다.
  key: z.string().trim().min(1, "API 키를 입력해 주세요").max(500),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  return Response.json({ keys: ENGINE_IDS.map(engineKeyStatus) });
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "요청이 올바르지 않습니다", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { engine, key } = parsed.data;

  upsertEngineSecret({
    engine,
    secret: encryptSecret(key),
    hint: maskSecret(key),
  });

  return Response.json({ key: engineKeyStatus(engine) });
}

/** 등록된 키를 지운다. 이후 다시 등록할 때까지 해당 엔진은 사용할 수 없다. */
export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const engine = new URL(request.url).searchParams.get("engine");
  if (!isEngineId(engine)) {
    return Response.json({ error: "지원하지 않는 번역 엔진입니다" }, { status: 400 });
  }

  deleteEngineSecret(engine);
  return Response.json({ key: engineKeyStatus(engine) });
}
