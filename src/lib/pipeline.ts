import "server-only";

import type { LanguageCode } from "@/lib/languages";
import { publish } from "@/lib/realtime/hub";
import {
  getMeetingActiveLangs,
  getRecentSourceBodies,
  insertMessage,
  insertMessageOnce,
  type Meeting,
  type Message,
  upsertTranslation,
} from "@/lib/repo";
import { TranslationError, translateText } from "@/lib/translate";

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
}) {
  const message = insertMessage({
    meetingId: input.meeting.id,
    pageId: input.pageId,
    lang: input.lang,
    body: input.body,
    speakerName: input.speakerName,
  });

  publishMessage(input.meeting.id, message);

  return message;
}

/** Realtime 완료 이벤트를 멱등하게 저장·배포한다. */
export function acceptTranscript(input: {
  meeting: Meeting;
  pageId: string;
  lang: LanguageCode;
  body: string;
  ingestKey: string;
  speakerName?: string | null;
}) {
  const result = insertMessageOnce({
    meetingId: input.meeting.id,
    pageId: input.pageId,
    lang: input.lang,
    body: input.body,
    speakerName: input.speakerName,
    ingestKey: input.ingestKey,
  });

  if (result.inserted) {
    publishMessage(input.meeting.id, result.message);
  }

  return result;
}

/**
 * 원문을 회의의 나머지 언어로 번역해 저장·배포한다.
 *
 * 언어끼리는 서로 독립이라 동시에 돌린다. 하나가 실패해도 나머지는 살아야 하므로
 * `allSettled` 로 각각의 결과를 따로 처리한다. 실패도 `status: 'error'` 로 저장해서,
 * 어느 문장이 전달되지 않았는지 대시보드에서 보이게 한다.
 */
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
  const targets = getMeetingActiveLangs(input.meeting.id).filter(
    (lang) => lang !== input.sourceLang,
  );

  // 문맥은 LLM 엔진만 쓴다. 기계 번역 엔진이면 조회 자체를 건너뛴다.
  const context =
    input.meeting.engine === "openai" || input.meeting.fallbackEngine === "openai"
      ? getRecentSourceBodies(input.meeting.id, input.messageId)
      : undefined;

  await Promise.allSettled(
    targets.map(async (target) => {
      try {
        const result = await translateText(
          input.meeting.engine,
          {
            text: input.body,
            from: input.sourceLang,
            to: target,
            context,
            model: input.meeting.translationModel,
          },
          input.meeting.fallbackEngine,
        );

        const createdAt = upsertTranslation({
          messageId: input.messageId,
          revision: input.revision,
          lang: target,
          body: result.text,
          engine: result.engine,
          status: "ok",
        });
        if (createdAt === null) return;

        publish(input.meeting.id, {
          t: "translation",
          messageId: input.messageId,
          sourceLang: input.sourceLang,
          lang: target,
          body: result.text,
          speakerName: input.speakerName ?? null,
          engine: result.engine,
          status: "ok",
          revision: input.revision,
          editedAt: input.editedAt ?? null,
          sourceCreatedAt: input.createdAt,
          createdAt,
        });
      } catch (cause) {
        const reason =
          cause instanceof TranslationError
            ? cause.code ?? cause.message
            : cause instanceof Error
              ? cause.message
              : "번역에 실패했습니다";

        const createdAt = upsertTranslation({
          messageId: input.messageId,
          revision: input.revision,
          lang: target,
          body: "",
          engine: input.meeting.engine,
          status: "error",
          error: reason,
        });
        if (createdAt === null) return;

        publish(input.meeting.id, {
          t: "translation",
          messageId: input.messageId,
          sourceLang: input.sourceLang,
          lang: target,
          body: "",
          speakerName: input.speakerName ?? null,
          engine: input.meeting.engine,
          status: "error",
          error: reason,
          revision: input.revision,
          editedAt: input.editedAt ?? null,
          sourceCreatedAt: input.createdAt,
          createdAt,
        });
      }
    }),
  );
}
