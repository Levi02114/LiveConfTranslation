import { requireAdmin } from "@/lib/auth";
import { desktopActionSchema, desktopTransportAllowed } from "@/lib/desktop-control";
import { notifyAppSettings } from "@/lib/voice-settings";

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ desktop: globalThis.__liveConfDesktopControl?.snapshot() ?? null,
    writable: desktopTransportAllowed(request.url, request.headers) });
}
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!desktopTransportAllowed(request.url, request.headers)) return Response.json({ error: "secure-required" }, { status: 403 });
  const parsed = desktopActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  const bridge = globalThis.__liveConfDesktopControl;
  if (!bridge) return Response.json({ error: "unavailable" }, { status: 503 });
  if (globalThis.__liveConfDesktopBusy) return Response.json({ error: "busy" }, { status: 409 });
  globalThis.__liveConfDesktopBusy = true;
  try {
    const result = await bridge.run(parsed.data);
    return Response.json({ ...result, desktop: bridge.snapshot() }, { status: result.error ? 400 : 200 });
  } catch {
    return Response.json({ error: "genericError" }, { status: 500 });
  } finally {
    globalThis.__liveConfDesktopBusy = false;
    notifyAppSettings();
  }
}
