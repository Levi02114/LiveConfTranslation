import { z } from "zod";
import { openaiBaseUrl } from "./env";
import { listOpenaiModels, replaceOpenaiModels } from "./repo";
import { engineKey, resolveOpenaiModel } from "./secrets";

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(100).regex(/^[\w.:-]+$/) })).min(1),
});

/** 목록 조회 실패와 키 교체 중 응답으로 마지막 성공 캐시를 덮어쓰지 않는다. */
export async function getOpenaiModelCatalog(refresh = true) {
  let source: "live" | "cache" | "no-key" | "error" = "cache";
  if (refresh) {
    const key = engineKey("openai");
    if (!key) source = "no-key";
    else {
      try {
        const response = await fetch(`${openaiBaseUrl()}/models`, {
          headers: { authorization: `Bearer ${key}` },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("model-list-failed");
        const payload = modelListSchema.parse(await response.json());
        if (engineKey("openai") !== key) throw new Error("key-changed");
        const models = [...new Set(payload.data.map(({ id }) => id))].sort();
        const cached = listOpenaiModels();
        if (models.length !== cached.length || models.some((model, index) => model !== cached[index])) {
          replaceOpenaiModels(models);
        }
        source = "live";
      } catch {
        // 응답 본문에는 제공자/키 정보가 있을 수 있으므로 UI나 로그로 전달하지 않는다.
        source = "error";
      }
    }
  }
  return { models: listOpenaiModels(), model: resolveOpenaiModel(), source };
}
