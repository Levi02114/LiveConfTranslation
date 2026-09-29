"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createScrollFollow, FOLLOW_SCROLL_CSS } from "@/lib/follow-scroll";
import type { UiStrings } from "@/lib/i18n-builtin";

export function ScrollToLatest({ scrollRef, contentRef, items, strings }: {
  scrollRef: RefObject<HTMLDivElement | null>; contentRef: RefObject<HTMLDivElement | null>;
  items: ({ id: number } | { messageId: number })[]; strings: UiStrings["status"];
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const controller = useRef<ReturnType<typeof createScrollFollow> | null>(null);
  const initial = useRef(true);
  useEffect(() => {
    if (!scrollRef.current || !contentRef.current || !buttonRef.current) return;
    controller.current = createScrollFollow(scrollRef.current, contentRef.current, buttonRef.current);
    initial.current = true;
    return () => { controller.current?.destroy(); controller.current = null; };
  }, [scrollRef, contentRef]);
  useEffect(() => {
    for (const item of items) controller.current?.update(String("id" in item ? item.id : item.messageId), JSON.stringify(item), initial.current);
    initial.current = false;
    controller.current?.follow();
  }, [items]);
  return <>
    <style>{FOLLOW_SCROLL_CSS}</style>
    <button ref={buttonRef} type="button" className="scroll-latest" aria-label={strings.scrollToLatest} title={strings.scrollToLatest}>
      <span aria-hidden="true">↓</span><span data-unread hidden aria-label={strings.newMessages} aria-live="polite">0</span>
    </button>
  </>;
}
