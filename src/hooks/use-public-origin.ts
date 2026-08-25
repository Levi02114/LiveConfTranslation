"use client";

import { useSyncExternalStore } from "react";

const PUBLIC_ORIGIN_KEY = "lct_public_origin";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("lct-public-origin", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("lct-public-origin", onStoreChange);
  };
}

function getOrigin() {
  return localStorage.getItem(PUBLIC_ORIGIN_KEY) ?? window.location.origin;
}

/** Electron/LAN/Cloudflare 중 관리자가 고른 실제 공유 origin. */
export function usePublicOrigin(): string {
  return useSyncExternalStore(subscribe, getOrigin, () => "");
}
