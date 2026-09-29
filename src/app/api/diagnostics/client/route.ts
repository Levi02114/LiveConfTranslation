import { isAdmin } from "@/lib/auth";
import { getPageByToken, isPageEnabled } from "@/lib/repo";
import { log } from "@/lib/diagnostics";
import { rateLimit } from "@/lib/security-limits";
import { clientDiagnosticSchema } from "@/lib/client-diagnostic-schema";

export async function POST(request: Request) {
  const parsed = clientDiagnosticSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  const page = parsed.data.token ? getPageByToken(parsed.data.token) : null;
  if (!(await isAdmin()) && (!page || !isPageEnabled(page))) return Response.json({ error: "auth-required" }, { status: 401 });
  // Lifecycle events arrive in short bursts; still bounded per source IP and by disk retention.
  if (rateLimit(`diagnostics:${request.headers.get("x-lct-ip") ?? "unknown"}`, 2, 120)) return new Response(null, { status: 429 });
  const { event, ...fields } = parsed.data;
  delete fields.token;
  // Client-reported events are explicitly distinguished from trusted server events.
  log(["error", "rejection", "resource-error", "fetch-failed"].includes(event) || fields.errorType ? "warn" : "info", `client.${event}`, fields);
  return new Response(null, { status: 204 });
}
