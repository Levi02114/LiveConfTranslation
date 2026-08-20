import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { openaiBaseUrl } from "@/lib/env";
import { parseJsonResponse } from "@/lib/json-response";
import { listOpenaiModels, replaceOpenaiModels } from "@/lib/repo";
import { engineKey, resolveOpenaiModel } from "@/lib/secrets";

/**
 * 고를 수 있는 OpenAI 언어모델 목록.
 *
 * 계정마다 쓸 수 있는 모델이 다르므로 목록을 코드에 박지 않고 물어본다.
 * 관리 화면은 DB 캐시를 먼저 그리고 이 경로로 최신 목록을 요청한다. 실패하면
 * 캐시를 그대로 돌려주므로 키나 네트워크가 잠시 없어도 드롭다운이 비지 않는다.
 *
 * **평문 키는 응답에 담기지 않는다.** 여기서는 호출에만 쓴다.
 */

/** 번역에 쓸 수 없는 모델을 걸러 낸다. 목록에 100개가 뜨면 고를 수가 없다. */
const EXCLUDE = /embedding|tts|whisper|dall-e|audio|realtime|image|moderation|transcribe/i;
const INCLUDE = /^(gpt|chatgpt|o\d)/i;
const modelsResponseSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const current = resolveOpenaiModel();
  const cached = listOpenaiModels();
  const fallback = {
    models: cached.length ? cached : [current],
    source: cached.length ? ("cache" as const) : ("fallback" as const),
  };

  const key = engineKey("openai");
  if (!key) return Response.json(fallback);

  try {
    const response = await fetch(`${openaiBaseUrl()}/models`, {
      headers: { authorization: `Bearer ${key}` },
      // 목록 하나 받자고 관리자를 오래 기다리게 하지 않는다.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return Response.json(fallback);

    const payload = await parseJsonResponse(response, modelsResponseSchema);
    if (!payload) return Response.json(fallback);
    const models = payload.data
      .map((item) => item.id)
      .filter((id) => INCLUDE.test(id) && !EXCLUDE.test(id))
      .sort();

    if (models.length === 0) return Response.json(fallback);

    // 지금 쓰는 모델이 목록에 없어도(예: 사내 별칭) 현재 선택은 유지해야 한다.
    if (!models.includes(current)) models.unshift(current);

    if (
      models.length !== cached.length ||
      models.some((model, index) => model !== cached[index])
    ) {
      replaceOpenaiModels(models);
    }

    return Response.json({ models, source: "api" as const });
  } catch {
    return Response.json(fallback);
  }
}
