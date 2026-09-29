"use client";

import { useEffect, useRef, useState } from "react";

// Renderer dialogs avoid Electron's native confirm/focus problems on Windows.
export function useConfirmation(labels: { confirm: string; cancel: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const [message, setMessage] = useState("");
  const finish = (accepted: boolean) => {
    const pending = resolve.current;
    resolve.current = null;
    dialog.current?.close();
    pending?.(accepted);
  };
  useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
  return {
    confirm: (text: string) => {
      if (resolve.current || !dialog.current) return Promise.resolve(false);
      setMessage(text);
      return new Promise<boolean>((done) => {
        resolve.current = done;
        dialog.current!.showModal();
      });
    },
    confirmation: <dialog ref={dialog} aria-label={message} onCancel={(event) => { event.stopPropagation(); event.preventDefault(); finish(false); }}
      onClose={(event) => { event.stopPropagation(); finish(false); }} className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto border border-line bg-bg p-5 text-fg backdrop:bg-black/45">
      <p className="break-words">{message}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button autoFocus onClick={() => finish(false)}>{labels.cancel}</button>
        <button onClick={() => finish(true)}>{labels.confirm}</button>
      </div>
    </dialog>,
  };
}
