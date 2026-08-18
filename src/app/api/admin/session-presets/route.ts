import { requireAdmin } from "@/lib/auth";
import {
  deleteSessionPreset,
  hasLanguage,
  listSessionPresets,
  upsertSessionPreset,
} from "@/lib/repo";
import { presetSchema } from "@/lib/session-config";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ presets: listSessionPresets() });
}
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = presetSchema.safeParse(await request.json().catch(() => null));
  if (
    !parsed.success ||
    parsed.data.config.languages.some((row) => !hasLanguage(row.lang))
  ) {
    return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });
  }

  try {
    const preset = upsertSessionPreset({
      id: parsed.data.id,
      name: parsed.data.name,
      config: {
        ...parsed.data.config,
        languages: parsed.data.config.languages.map((row) => ({
          ...row,
          lang: row.lang,
        })),
      },
    });
    return Response.json({ preset }, { status: parsed.data.id ? 200 : 201 });
  } catch {
    return Response.json({ error: "같은 이름의 프리셋이 있습니다" }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "프리셋 ID가 필요합니다" }, { status: 400 });
  return deleteSessionPreset(id)
    ? Response.json({ deleted: true })
    : Response.json({ error: "프리셋을 찾을 수 없습니다" }, { status: 404 });
}
