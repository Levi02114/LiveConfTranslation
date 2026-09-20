import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { listLanguages } from "@/lib/repo";
import { rateLimit } from "@/lib/security-limits";
import { translateText, engineIdSchema } from "@/lib/translate";
import { desktopTransportAllowed } from "@/lib/desktop-control";
const schema = z.object({ text: z.string().trim().min(1).max(10000), from: z.string().max(35), to: z.string().max(35), engine: engineIdSchema }).strict();
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!desktopTransportAllowed(request.url, request.headers)) return Response.json({ error: "secure-required" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const langs = new Set(listLanguages().map((row) => row.code));
  if (!parsed.success || !langs.has(parsed.data.from) || !langs.has(parsed.data.to)) return Response.json({ error: "invalid-request" }, { status: 400 });
  if (rateLimit("admin-voice-test", 1, 4)) return Response.json({ error: "busy" }, { status: 429 });
  const started = Date.now();
  try {
    const { text, from, to, engine } = parsed.data;
    const result = await translateText(engine, { text, from, to, signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]) });
    return Response.json({ text: result.text, elapsedMs: Date.now() - started });
  } catch { return Response.json({ error: "translation-failed" }, { status: 502 }); }
}
