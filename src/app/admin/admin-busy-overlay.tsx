export function AdminBusyOverlay({ label }: { label: string | null }) {
  if (!label) return null;

  return (
    <div
      data-admin-busy
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-muted/30 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 border border-line bg-bg px-5 py-4">
        <span
          aria-hidden
          className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-fg"
        />
        <span className="font-mono text-[12px]">{label}</span>
      </div>
    </div>
  );
}
