"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_KEY,
  type FontSize,
  FONT_SIZES,
  isFontSize,
  isTheme,
  type Theme,
  THEME_KEY,
} from "@/lib/appearance";

/**
 * 테마·글자 크기를 읽고 바꾸는 훅. 모든 페이지에서 같은 것을 쓴다.
 *
 * 값의 진짜 주인은 React 가 아니라 **`<html>` 의 속성**이다. 첫 페인트 깜빡임을
 * 막으려고 React 가 붙기 전에 인라인 스크립트가 먼저 찍어 두기 때문이다
 * (`APPEARANCE_INIT_SCRIPT`).
 *
 * 그래서 상태를 복제하지 않고 `useSyncExternalStore` 로 DOM 을 직접 구독한다.
 * effect 로 베껴 오면 하이드레이션 직후 한 번 더 렌더링되고, 두 벌의 진실이 생긴다.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function getThemeSnapshot(): Theme | null {
  const value = document.documentElement.getAttribute("data-theme");
  return isTheme(value) ? value : null;
}

function getFontSizeSnapshot(): FontSize {
  const value = document.documentElement.getAttribute("data-size");
  return isFontSize(value) ? value : DEFAULT_FONT_SIZE;
}

/** 서버에는 DOM 이 없다. 사용자가 아직 고르지 않은 것과 같은 상태로 렌더한다. */
function getServerThemeSnapshot(): Theme | null {
  return null;
}

function getServerFontSizeSnapshot(): FontSize {
  return DEFAULT_FONT_SIZE;
}

export function useAppearance() {
  const theme = useSyncExternalStore(
    subscribe,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const fontSize = useSyncExternalStore(
    subscribe,
    getFontSizeSnapshot,
    getServerFontSizeSnapshot,
  );

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // 시크릿 모드 등으로 저장이 막혀 있어도 이번 세션 동안은 적용된다.
    }
    notify();
  }, []);

  const setFontSize = useCallback((next: FontSize) => {
    document.documentElement.setAttribute("data-size", next);
    try {
      localStorage.setItem(FONT_SIZE_KEY, next);
    } catch {
      // 위와 같다.
    }
    notify();
  }, []);

  /** 아직 고른 적이 없으면 기기 설정의 반대로 넘긴다. */
  const toggleTheme = useCallback(() => {
    const current =
      theme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(current === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const stepFontSize = useCallback(
    (direction: 1 | -1) => {
      const index = FONT_SIZES.indexOf(fontSize);
      const next =
        FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, index + direction))];
      if (next !== fontSize) setFontSize(next);
    },
    [fontSize, setFontSize],
  );

  return { theme, fontSize, setTheme, setFontSize, toggleTheme, stepFontSize };
}
