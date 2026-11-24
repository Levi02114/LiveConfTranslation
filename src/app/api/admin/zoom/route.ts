import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { getZoomMeeting, getMeetingActiveLangs, getMeetingPages } from "@/lib/repo";
import { notifyConnectionsChanged } from "@/lib/realtime/hub";
import { log } from "@/lib/diagnostics";
import { desktopTransportAllowed } from "@/lib/desktop-control";
import { zoomActionSchema, zoomCredentialsSchema } from "@/lib/zoom-contract";
import { ownedZoomRelay, saveZoomCredentials, startZoomRelay, zoomSettingsStatus } from "@/lib/zoom";

export const dynamic = "force-dynamic";

function settings(request: Request) {
  const share = globalThis.__liveConfDesktopControl?.snapshot().origin;
  const origin = share?.startsWith("https://") ? share : `${request.headers.get("x-forwarded-proto") === "https" ? "https" : "http"}://${request.headers.get("host") ?? new URL(request.url).host}`;
  const uuid = new URL(request.url).searchParams.get("meeting");
  const meeting = uuid && uuid.length <= 256 ? getZoomMeeting(uuid) : null;
  const viewer = meeting && getMeetingPages(meeting.id).find((page) => page.kind === "combined");
  return { ...zoomSettingsStatus(), writable: desktopTransportAllowed(request.url, request.headers),
    existingSession: meeting ? { id: meeting.id, title: meeting.title, closed: meeting.status === "closed",
      engine: meeting.engine, fallbackEngine: meeting.fallbackEngine, model: meeting.translationModel,
      targets: getMeetingActiveLangs(meeting.id), viewerPath: viewer ? `/all/${viewer.token}` : "" } : null,
    homeUrl: `${origin}/admin/zoom`, webhookUrl: `${origin}/api/zoom/webhook` };
}

export async function GET(request: Request) {
  const denied = await requireAdmin();
  return denied ?? Response.json(settings(request), { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!desktopTransportAllowed(request.url, request.headers)) return Response.json({ error: "insecure" }, { status: 403 });
  const parsed = zoomCredentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "requestFailed" }, { status: 400 });
  try {
    saveZoomCredentials(parsed.data);
    return Response.json(settings(request));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!desktopTransportAllowed(request.url, request.headers)) return Response.json({ error: "insecure" }, { status: 403 });
  const parsed = zoomActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "requestFailed" }, { status: 400 });
  try {
    const action = parsed.data;
    if (action.action === "stop" && action.sdk) log("info", "zoom.sdk-stop", { phase: action.sdk.response, code: action.sdk.code, state: action.sdk.status });
    const relay = action.action === "start" ? startZoomRelay(action) : ownedZoomRelay(action.owner);
    if (action.action === "start") {
      notifyConnectionsChanged(relay.meeting.id);
      revalidatePath("/admin");
      revalidatePath("/admin/zoom");
    }
    if (action.action === "stop") relay.stop();
    if (action.action === "assign") relay.assign(action.speaker, action.lang);
    return Response.json(relay.poll(action.action === "poll" ? action.ack : undefined), { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Only our fixed domain error codes may cross the HTTP boundary.
function failure(error: unknown) {
  const code = error instanceof Error && ["busy", "notConfigured", "invalidSession", "invalidLanguage", "sessionSettingsMismatch", "requestFailed"].includes(error.message) ? error.message : "requestFailed";
  return Response.json({ error: code }, { status: code === "busy" ? 409 : 400 });
}
