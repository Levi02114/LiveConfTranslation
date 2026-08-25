"use client";

import Image from "next/image";
import type { RefObject } from "react";

import type { AdminStrings } from "@/lib/i18n-builtin";

export type QrImage = { dataUrl: string; fileName: string };

export async function generateQr(url: string, fileName: string): Promise<QrImage> {
  const { toDataURL } = await import("qrcode");
  return { dataUrl: await toDataURL(url, { width: 320, margin: 2 }), fileName };
}

export function QrDialog({
  dialogRef,
  qr,
  error,
  onClose,
  strings,
  buttonClass,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  qr: QrImage | null;
  error: string | null;
  onClose: () => void;
  strings: AdminStrings["dashboard"];
  buttonClass: string;
}) {
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[min(380px,calc(100vw-32px))] border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
    >
      <div className="p-6">
        <div className="flex min-h-[320px] items-center justify-center bg-fg">
          {qr ? (
            <Image
              unoptimized
              src={qr.dataUrl}
              width={320}
              height={320}
              alt={strings.showQr}
              className="h-auto w-full"
            />
          ) : (
            <span className="font-mono text-[12px] text-bg">{error ?? "…"}</span>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {qr ? (
            <a href={qr.dataUrl} download={qr.fileName} className={buttonClass}>
              {strings.downloadQr}
            </a>
          ) : null}
          <button type="button" onClick={() => dialogRef.current?.close()} className={buttonClass}>
            {strings.closeQr}
          </button>
        </div>
      </div>
    </dialog>
  );
}
