type Fields = Record<string, string | number | boolean | null | undefined>;
type Level = "info" | "warn" | "error";
export function log(level: Level, event: string, fields?: Fields): void;
export function safeRoute(path: string): string;
// Parser for arbitrary values thrown at an error boundary.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export function errorFields(error: unknown): { errorType: string; code: string };
export function safeFields(fields?: Fields): Fields;
export function withContext<T>(fields: Fields, callback: () => T): T;
export function flushDiagnostics(): Promise<void>;
export function createLogger(directory: string, options?: { now?: () => number; maxBytes?: number }): {
  log: typeof log; flush: () => Promise<void>; close: () => Promise<void>;
};
export function initializeDiagnostics(directory: string): ReturnType<typeof createLogger>;
