import "server-only";

import type { LanguageCode } from "@/lib/languages";
import { publish } from "@/lib/realtime/hub";
import {
  insertMessageOnce,
  type Meeting,
  type Message,
} from "@/lib/repo";
import { publishJobCounts, wakeTranslationWorker } from "@/lib/translation-worker";

/**
 * 입력 → 저장 → 번역 → 배포로 이어지는 회의 파이프라인.
 *
 * 원문은 **먼저** 저장하고 알린다. 번역이 느리거나 실패해도 원문은 회의 로그에
 * 남아야 하고, 대시보드와 입력 페이지에서도 바로 보여야 하기 때문이다.
 */

/** 원문을 받아 저장하고 즉시 배포한다. 번역은 호출부가 이어서 돌린다. */
export function publishMessage(meetingId: string, message: Message): void {
  publish(meetingId, {
    t: "message",
    messageId: message.id,
    pageId: message.pageId,
    lang: message.lang,
    body: message.body,
    speakerName: message.speakerName,
    revision: message.revision,
    editedAt: message.editedAt,
    createdAt: message.createdAt,
  });
}

export function acceptMessage(input: {
  meeting: Meeting;
  pageId: string | null;
  lang: LanguageCode;
  body: string;
  speakerName?: string | null;
  ingestKey?: string;
  fingerprint?: string;
}) {
  const result = insertMessageOnce({
    meetingId: input.meeting.id,
    pageId: input.pageId,
    lang: input.lang,
    body: input.body,
    speakerName: input.speakerName,
    ingestKey: input.ingestKey,
    fingerprint: input.fingerprint,
  });

  if (result.inserted) publishMessage(input.meeting.id, result.message);

  return result;
}

/** Realtime 완료 이벤트를 멱등하게 저장·배포한다. */
export function acceptTranscript(input: {
  meeting: Meeting;
  pageId: string;
  lang: LanguageCode;
  body: string;
  ingestKey: string;
  fingerprint?: string;
  speakerName?: string | null;
}) {
  const result = insertMessageOnce({
    meetingId: input.meeting.id,
    pageId: input.pageId,
    lang: input.lang,
    body: input.body,
    speakerName: input.speakerName,
    ingestKey: input.ingestKey,
    fingerprint: input.fingerprint,
  });

  if (result.inserted) {
    publishMessage(input.meeting.id, result.message);
  }

  return result;
}

/** Jobs were saved atomically with the source; wake the shared worker. */
export async function translateMessage(input: {
  meeting: Meeting;
  messageId: number;
  sourceLang: LanguageCode;
  body: string;
  speakerName?: string | null;
  revision: number;
  editedAt?: number | null;
  createdAt: number;
}): Promise<void> {
  publishJobCounts(input.meeting.id);
  wakeTranslationWorker();
}
