import { z } from "zod";

/** 네트워크 JSON을 스키마로 확인한다. 비정상 응답은 호출자가 기존 오류 흐름으로 처리한다. */
export async function parseJsonResponse<S extends z.ZodType>(
  response: Response,
  schema: S,
): Promise<z.output<S> | null> {
  const payload = await response.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
