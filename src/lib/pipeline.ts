import "server-only";

import type { LanguageCode } from "@/lib/languages";
import { publish } from "@/lib/realtime/hub";
import {
  getMeetingLangs,
  getRecentSourceBodies,
  insertMessage,
  insertMessageOnce,
  type Meeting,
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
export function acceptMessage(input: {
  meeting: Meeting;
  pageId: string | null;
  lang: LanguageCode;
  body: string;
}) {
  const message = insertMessage({
    meetingId: input.meeting.id,
    pageId: input.pageId,
    lang: input.lang,
    body: input.body,
  });

  publish(input.meeting.id, {
    t: "message",
    messageId: message.id,
    lang: message.lang,
    body: message.body,
    createdAt: message.createdAt,
  });

  return message;
}

/** Realtime 완료 이벤트를 멱등하게 저장·배포한다. */
export function acceptTranscript(input: {
  meeting: Meeting;
  pageId: string;
  lang: LanguageCode;
  body: string;
  ingestKey: string;
}) {
  const result = insertMessageOnce({
    meetingId: input.meeting.id,
    pageId: input.pageId,
    lang: input.lang,
    body: input.body,
    ingestKey: input.ingestKey,
  });

  if (result.inserted) {
    publish(input.meeting.id, {
      t: "message",
      messageId: result.message.id,
      lang: result.message.lang,
      body: result.message.body,
      createdAt: result.message.createdAt,
    });
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
}): Promise<void> {
  const targets = getMeetingLangs(input.meeting.id).filter(
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
          },
          input.meeting.fallbackEngine,
        );

        const createdAt = upsertTranslation({
          messageId: input.messageId,
          lang: target,
          body: result.text,
          engine: result.engine,
          status: "ok",
        });

        publish(input.meeting.id, {
          t: "translation",
          messageId: input.messageId,
          sourceLang: input.sourceLang,
          lang: target,
          body: result.text,
          engine: result.engine,
          status: "ok",
          createdAt,
        });
      } catch (cause) {
        const reason =
          cause instanceof TranslationError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : "번역에 실패했습니다";

        const createdAt = upsertTranslation({
          messageId: input.messageId,
          lang: target,
          body: "",
          engine: input.meeting.engine,
          status: "error",
          error: reason,
        });

        publish(input.meeting.id, {
          t: "translation",
          messageId: input.messageId,
          sourceLang: input.sourceLang,
          lang: target,
          body: "",
          engine: input.meeting.engine,
          status: "error",
          error: reason,
          createdAt,
        });
      }
    }),
  );
}
