import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { deleteEngineSecret, upsertEngineSecret } from "@/lib/repo";
import {
  googleSpeechCredentialsSchema,
  googleSpeechCredentialsStatus,
} from "@/lib/secrets";

const SECRET_ID = "google-speech" as const;
const saveSchema = z.object({
  credentials: z.string().min(1).max(32_000),
}).strict();

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ credentials: googleSpeechCredentialsStatus() });
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = saveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(body.data.credentials);
  } catch {
    return Response.json({ error: "Google 서비스 계정 JSON이 올바르지 않습니다" }, { status: 400 });
  }
  const credentials = googleSpeechCredentialsSchema.safeParse(decoded);
  if (!credentials.success) {
    return Response.json({ error: "Google 서비스 계정 JSON이 올바르지 않습니다" }, { status: 400 });
  }

  upsertEngineSecret({
    engine: SECRET_ID,
    secret: encryptSecret(JSON.stringify(credentials.data)),
    hint: credentials.data.project_id,
  });
  return Response.json({ credentials: googleSpeechCredentialsStatus() });
}

export async function DELETE() {
  const denied = await requireAdmin();
  if (denied) return denied;
  deleteEngineSecret(SECRET_ID);
  return Response.json({ credentials: googleSpeechCredentialsStatus() });
}
