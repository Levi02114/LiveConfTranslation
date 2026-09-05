"use client";

import { useEffect, useRef, useState } from "react";

import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";

const STORAGE_KEY = "live-conf-translation:app-guide";

type GuideStage = "admin" | "dashboard";
type Step = { target?: string; title: string; body: string };
type TargetBox = { top: number; right: number; bottom: number; left: number };

export function continueAppGuideToDashboard() {
  if (sessionStorage.getItem(STORAGE_KEY) === "admin") {
    sessionStorage.setItem(STORAGE_KEY, "dashboard");
  }
}

function clearGuideQuery(): boolean {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("guide")) return false;
  url.searchParams.delete("guide");
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
  return true;
}

export function AppGuide({
  stage,
  strings,
  ui,
}: {
  stage: GuideStage;
  strings: AdminStrings;
  ui: UiStrings;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<TargetBox | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const steps: Step[] = stage === "admin"
    ? [
        { title: strings.guide.title, body: strings.guide.welcome },
        { target: "[data-guide='appearance']", title: ui.appearance.theme, body: strings.guide.appearance },
        { target: "[data-guide='admin-qr']", title: strings.dashboard.showQr, body: strings.guide.adminQr },
        { target: "[data-guide='session-basics']", title: strings.list.titlePlaceholder, body: strings.guide.sessionBasics },
        { target: "[data-guide='languages']", title: strings.list.languages, body: strings.guide.languages },
        { target: "[data-guide='session-settings']", title: strings.settings.heading, body: strings.guide.sessionSettings },
        { target: "[data-guide='translation-engine']", title: strings.list.engine, body: strings.guide.translation },
        { target: "[data-guide='transcription-engine']", title: strings.list.transcriptionProvider, body: strings.guide.transcription },
        { target: "[data-guide='fallback-engine']", title: strings.list.fallbackEngine, body: strings.guide.fallback },
        { target: "[data-guide='create-session']", title: strings.list.create, body: strings.guide.create },
        { target: "[data-guide='session-list']", title: strings.list.active, body: strings.guide.sessionList },
      ]
    : [
        { target: "[data-guide='session-overview']", title: strings.guide.title, body: strings.guide.overview },
        { target: "[data-guide='records']", title: strings.dashboard.log, body: strings.guide.records },
        { target: "[data-guide='participants']", title: strings.dashboard.participantStatus, body: strings.guide.participants },
        { target: "[data-guide='pages']", title: strings.dashboard.pages, body: strings.guide.pages },
        { target: "[data-guide='page-actions']", title: strings.dashboard.showQr, body: strings.guide.pageActions },
        { target: "[data-guide='transcription-context']", title: strings.settings.transcriptionContext, body: strings.guide.context },
        { title: strings.guide.finish, body: strings.guide.done },
      ];
  const selector = steps[index]?.target;

  useEffect(() => {
    const requested = stage === "admin" && new URLSearchParams(window.location.search).get("guide") === "1";
    if (requested) {
      sessionStorage.setItem(STORAGE_KEY, "admin");
    }
    if (!requested && sessionStorage.getItem(STORAGE_KEY) !== stage) return;
    const timer = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (!open) return;
    const element = selector ? document.querySelector<HTMLElement>(selector) : null;

    const update = () => {
      if (!element) {
        setTarget(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      setTarget({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
    };

    element?.scrollIntoView({ behavior: "auto", block: "center" });
    update();
    const timer = window.setTimeout(update, 250);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    nextRef.current?.focus();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, selector]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      sessionStorage.removeItem(STORAGE_KEY);
      if (clearGuideQuery()) return;
      setOpen(false);
      setIndex(0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const stop = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    if (clearGuideQuery()) return;
    setOpen(false);
    setIndex(0);
  };
  const next = () => {
    if (index < steps.length - 1) {
      setIndex((current) => current + 1);
      return;
    }
    if (stage === "admin") sessionStorage.setItem(STORAGE_KEY, "dashboard");
    else sessionStorage.removeItem(STORAGE_KEY);
    if (clearGuideQuery()) return;
    setOpen(false);
    setIndex(0);
  };

  if (!open) return null;
  const step = steps[index];
  if (!step) return null;
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const cardAbove = Boolean(
    target && target.top - viewportTop - 16 > viewportTop + viewportHeight - target.bottom - 16,
  );
  const availableCardHeight = target
    ? Math.max(
        160,
        cardAbove
          ? target.top - viewportTop - 30
          : viewportTop + viewportHeight - target.bottom - 30,
      )
    : viewportHeight - 32;

  return (
    <>
      {target ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[70] rounded-sm ring-2 ring-fg"
          style={{
            top: Math.max(4, target.top - 5),
            left: Math.max(4, target.left - 5),
            width: Math.max(1, target.right - target.left + 10),
            height: Math.max(1, target.bottom - target.top + 10),
            boxShadow: "0 0 0 9999px color-mix(in srgb, var(--fg) 62%, transparent)",
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] bg-fg/60" />
      )}

      <section
        role="dialog"
        aria-live="polite"
        aria-label={strings.guide.title}
        className="fixed z-[80] flex w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden border border-line bg-bg p-5 text-fg shadow-xl sm:p-6"
        style={target
          ? {
              left: Math.min(
                Math.max(viewportLeft + 16, target.left),
                Math.max(viewportLeft + 16, viewportLeft + viewportWidth - 436),
              ),
              maxHeight: availableCardHeight,
              ...(cardAbove
                ? { bottom: Math.max(16, window.innerHeight - target.top + 14) }
                : { top: Math.max(viewportTop + 16, target.bottom + 14) }),
            }
          : {
              top: viewportTop + viewportHeight / 2,
              left: viewportLeft + viewportWidth / 2,
              maxHeight: availableCardHeight,
              transform: "translate(-50%, -50%)",
            }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] text-muted">
              {strings.guide.step.replace("{current}", String(index + 1)).replace("{total}", String(steps.length))}
            </div>
            <h2 className="mt-2 text-[19px] font-medium break-words">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={stop}
            title={strings.guide.close}
            aria-label={strings.guide.close}
            className="shrink-0 cursor-pointer px-1 font-mono text-[18px] text-muted hover:text-fg"
          >
            ×
          </button>
        </div>
        <p className="mt-4 min-h-0 overflow-y-auto whitespace-pre-line text-[13px] leading-6 text-muted">{step.body}</p>
        <div className="mt-6 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={stop}
            className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
          >
            {strings.guide.close}
          </button>
          <div className="flex gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex((current) => current - 1)}
                className="cursor-pointer border border-line px-3 py-2 font-mono text-[12px] hover:border-fg"
              >
                {strings.guide.previous}
              </button>
            ) : null}
            <button
              ref={nextRef}
              type="button"
              onClick={next}
              className="cursor-pointer border border-fg bg-fg px-3 py-2 font-mono text-[12px] text-bg hover:opacity-75"
            >
              {index === steps.length - 1
                ? stage === "admin" ? strings.guide.continue : strings.guide.finish
                : strings.guide.next}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
