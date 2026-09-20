import { z } from "zod";

const limit = (value: number, max: number) => z.number().int().min(1).max(max).default(value);
export const securityLimitsSchema = z.object({
  inputPerSecond: limit(5, 1000),
  inputBurst: limit(10, 2000),
  inputPerMinute: limit(300, 60000),
  transcriptionPerSession: limit(8, 128),
  transcriptionTotal: limit(16, 256),
  translationOnline: limit(8, 128),
  translationLocal: limit(1, 16),
  jobsPerSession: limit(1000, 100000),
  jobsTotal: limit(5000, 500000),
  languages: limit(32, 128),
  connectionsTotal: limit(10000, 100000),
  connectionsPerIp: limit(8000, 100000),
});
export type SecurityLimits = z.infer<typeof securityLimitsSchema>;

type LoginWindow = { failures: number; pending: number; expires: number };
declare global { var __loginWindows: Map<string, LoginWindow> | undefined; }
export function beginLoginAttempt(ip: string) {
  const windows = globalThis.__loginWindows ??= new Map();
  const now = Date.now();
  if (windows.size >= 20000) for (const [key, window] of windows) if (window.expires <= now && !window.pending) windows.delete(key);
  if (!windows.has(ip) && windows.size >= 20000) return { retryAfter: 900, finish: () => {} };
  let window = windows.get(ip);
  if (!window || (window.expires <= now && !window.pending)) {
    window = { failures: 0, pending: 0, expires: now + 900000 };
    windows.set(ip, window);
  }
  if (window.failures + window.pending >= 10) return { retryAfter: Math.max(1, Math.ceil((window.expires - now) / 1000)), finish: () => {} };
  window.pending++;
  const current = window;
  return { retryAfter: 0, finish: (outcome: "success" | "failure" | "busy") => {
    current.pending--;
    if (outcome === "failure") current.failures++;
    if (outcome === "success") current.failures = 0;
  } };
}

type Bucket = { tokens: number; at: number; expires: number };
declare global { var __requestBuckets: Map<string, Bucket> | undefined; }

/** Bounded, shared token buckets. No queue is kept for rejected requests. */
export function rateLimit(key: string, rate: number, burst: number, now = Date.now()): number {
  const buckets = globalThis.__requestBuckets ??= new Map();
  if (buckets.size >= 20000) {
    for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
    if (!buckets.has(key) && buckets.size >= 20000) return 60;
  }
  const bucket = buckets.get(key) ?? { tokens: burst, at: now, expires: now };
  bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * rate / 1000);
  bucket.at = now;
  bucket.expires = now + burst / rate * 1000;
  buckets.set(key, bucket);
  if (bucket.tokens < 1) return Math.max(1, Math.ceil((1 - bucket.tokens) / rate));
  bucket.tokens--;
  return 0;
}
