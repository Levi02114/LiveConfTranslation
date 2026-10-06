import { requireAdmin } from "@/lib/auth";
import { getOpenaiModelCatalog } from "@/lib/openai-models";

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  return Response.json(await getOpenaiModelCatalog(new URL(request.url).searchParams.get("cache") !== "1"), {
    headers: { "cache-control": "no-store" },
  });
}
