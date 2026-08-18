"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { AdminStrings } from "@/lib/i18n-builtin";

import { AdminBusyOverlay } from "./admin-busy-overlay";

type ErrorCode =
  | "invalid-current"
  | "too-short"
  | "too-long"
  | "same-password"
  | "failed"
  | "invalid-request";

export function PasswordChangeDialog({
  strings,
}: {
  strings: AdminStrings["passwordChange"];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPending(false);
    setSuccess(false);
    setError(null);
  };

  const messageFor = (code: ErrorCode): string => {
    switch (code) {
      case "invalid-current":
        return strings.invalidCurrent;
      case "too-short":
        return strings.tooShort;
      case "too-long":
        return strings.tooLong;
      case "same-password":
        return strings.samePassword;
      default:
        return strings.failed;
    }
  };

  const submit = async () => {
    if (pending) return;
    if (newPassword.length < 12) {
      setError(strings.tooShort);
      return;
    }
    if (newPassword.length > 128) {
      setError(strings.tooLong);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(strings.mismatch);
      return;
    }
    if (newPassword === currentPassword) {
      setError(strings.samePassword);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: ErrorCode | "auth-required";
      } | null;

      if (response.status === 401) {
        router.replace("/admin/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(messageFor(payload?.error as ErrorCode));
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch {
      setError(strings.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <AdminBusyOverlay label={pending ? strings.saving : null} />
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
      >
        {strings.button}
      </button>

      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={reset}
        className="m-auto w-[min(440px,calc(100vw-32px))] border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-6 py-6 sm:px-7">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[12px] tracking-[0.04em] text-muted">
              {strings.title}
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={pending}
              className="cursor-pointer font-mono text-[12px] text-muted hover:text-fg disabled:cursor-default disabled:opacity-30"
            >
              {strings.close}
            </button>
          </div>

          {success ? (
            <div className="pt-7">
              <p role="status" className="font-mono text-[13px]">
                {strings.success}
              </p>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                className="mt-7 w-full cursor-pointer border border-fg py-2.5 font-mono text-[13px] transition-colors hover:bg-fg hover:text-bg"
              >
                {strings.close}
              </button>
            </div>
          ) : (
            <form
              className="mt-6 flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="flex flex-col gap-2 font-mono text-[11px] text-muted">
                <span>{strings.currentPassword}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="border-0 border-b border-line bg-transparent py-2 text-[14px] text-fg outline-none focus:border-fg"
                />
              </label>

              <label className="flex flex-col gap-2 font-mono text-[11px] text-muted">
                <span>{strings.newPassword}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-describedby="admin-password-hint"
                  className="border-0 border-b border-line bg-transparent py-2 text-[14px] text-fg outline-none focus:border-fg"
                />
              </label>

              <label className="flex flex-col gap-2 font-mono text-[11px] text-muted">
                <span>{strings.confirmPassword}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="border-0 border-b border-line bg-transparent py-2 text-[14px] text-fg outline-none focus:border-fg"
                />
              </label>

              <p id="admin-password-hint" className="font-mono text-[11px] text-muted">
                {strings.minimum}
              </p>
              {error ? (
                <p role="alert" className="font-mono text-[12px] text-fg">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  disabled={pending}
                  className="cursor-pointer border border-line px-4 py-2.5 font-mono text-[12px] text-muted hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-30"
                >
                  {strings.cancel}
                </button>
                <button
                  type="submit"
                  disabled={pending || !currentPassword || !newPassword || !confirmPassword}
                  className="cursor-pointer border border-fg px-4 py-2.5 font-mono text-[12px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
                >
                  {pending ? strings.saving : strings.save}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
