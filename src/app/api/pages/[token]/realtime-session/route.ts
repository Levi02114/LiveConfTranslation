import { createHash } from "node:crypto";

import { z } from "zod";

import { openaiBaseUrl } from "@/lib/env";
import {
  claimCapture,
  releaseCapture,
  renewCapture,
} from "@/lib/realtime/capture-lease";
import { getMeeting, getPageByToken } from "@/lib/repo";
import { engineKey } from "@/lib/secrets";

type Params = { params: Promise<{ token: string }> };

const startSchema = z.object({ clientId: z.string().min(8).max(100) });
const leaseSchema = z.object({ leaseId: z.string().uuid() });

function resolveCapture(token: string) {
  const page = getPageByToken(token);
  if (!page || page.kind !== "capture" || !page.lang) return null;
  const meeting = getMeeting(page.meetingId);
  if (!meeting || meeting.inputMode !== "realtime") return null;
  return { page, meeting, lang: page.lang };
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const target = resolveCapture(token);
  if (!target) return Response.json({ error: "음성 수집 페이지를 찾을 수 없습니다" }, { status: 404 });
  if (target.meeting.status === "closed") {
    return Response.json({ error: "종료된 세션입니다" }, { status: 409 });
  }

  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });

  const key = engineKey("openai");
  if (!key) return Response.json({ error: "OpenAI API 키가 필요합니다" }, { status: 409 });

  const lease = claimCapture(target.meeting.id, target.page.id, parsed.data.clientId);
  if (!lease) {
    return Response.json({ error: "다른 기기에서 음성을 수집하고 있습니다" }, { status: 409 });
  }

  const response = await fetch(`${openaiBaseUrl()}/realtime/client_secrets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "OpenAI-Safety-Identifier": createHash("sha256").update(target.page.id).digest("hex"),
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            noise_reduction: { type: "far_field" },
            transcription: {
              model: "gpt-live-transcribe",
              languages: [target.lang.toLowerCase()],
              delay: "medium",
              prompt:
                "A live meeting with multiple participants who take turns speaking. Transcribe only what is spoken in the expected language. Preserve wording, names, numbers, and terminology. Do not invent speaker names or labels; only add punctuation and spacing when clear.",
            },
            // gpt-live-transcribe 는 서버 VAD 를 지원하지 않는다. 브라우저가 무음을
            // 감지해 input_audio_buffer.commit 을 보내며 문장 경계를 확정한다.
            turn_detection: null,
          },
        },
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { value?: string; expires_at?: number; error?: { message?: string } }
    | null;
  if (!response.ok || !payload?.value) {
    releaseCapture(target.page.id, lease.leaseId);
    return Response.json(
      { error: payload?.error?.message ?? "OpenAI 전사 세션을 시작하지 못했습니다" },
      { status: 502 },
    );
  }

  return Response.json({
    leaseId: lease.leaseId,
    leaseExpiresAt: lease.expiresAt,
    clientSecret: payload.value,
    clientSecretExpiresAt: payload.expires_at ?? null,
    realtimeUrl: `${openaiBaseUrl()}/realtime/calls`,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { token } = await params;
  const target = resolveCapture(token);
  if (!target) return Response.json({ error: "음성 수집 페이지를 찾을 수 없습니다" }, { status: 404 });

  const parsed = leaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });
  if (target.meeting.status === "closed") {
    releaseCapture(target.page.id, parsed.data.leaseId);
    return Response.json({ error: "종료된 세션입니다" }, { status: 409 });
  }

  const lease = renewCapture(target.page.id, parsed.data.leaseId);
  return lease
    ? Response.json({ expiresAt: lease.expiresAt })
    : Response.json({ error: "음성 수집 권한이 만료되었습니다" }, { status: 409 });
}

export async function DELETE(request: Request, { params }: Params) {
  const { token } = await params;
  const target = resolveCapture(token);
  if (!target) return Response.json({ error: "음성 수집 페이지를 찾을 수 없습니다" }, { status: 404 });

  const parsed = leaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });
  releaseCapture(target.page.id, parsed.data.leaseId);
  return Response.json({ released: true });
}
