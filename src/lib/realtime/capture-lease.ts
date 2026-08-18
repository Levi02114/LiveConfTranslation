import { randomUUID } from "node:crypto";

/** 브라우저별 전사 세션이 완료 이벤트를 제출할 수 있게 하는 짧은 활성권. */
const TTL_MS = 20_000;

type Lease = {
  meetingId: string;
  pageId: string;
  clientId: string;
  leaseId: string;
  expiresAt: number;
};

type LeaseState = { leases: Map<string, Lease>; clients: Map<string, string> };

const shared = globalThis as unknown as { __captureLeases?: LeaseState };

function state(): LeaseState {
  return (shared.__captureLeases ??= { leases: new Map(), clients: new Map() });
}

const clientKey = (pageId: string, clientId: string) => `${pageId}:${clientId}`;

export function claimCapture(meetingId: string, pageId: string, clientId: string): Lease | null {
  const now = Date.now();
  const key = clientKey(pageId, clientId);
  const currentId = state().clients.get(key);
  const current = currentId ? state().leases.get(currentId) : undefined;
  if (current && current.expiresAt <= now) state().leases.delete(current.leaseId);

  const lease: Lease = {
    meetingId,
    pageId,
    clientId,
    leaseId: current?.expiresAt && current.expiresAt > now ? current.leaseId : randomUUID(),
    expiresAt: now + TTL_MS,
  };
  state().leases.set(lease.leaseId, lease);
  state().clients.set(key, lease.leaseId);
  return lease;
}

export function renewCapture(pageId: string, leaseId: string): Lease | null {
  const current = state().leases.get(leaseId);
  if (!current || current.pageId !== pageId || current.expiresAt <= Date.now()) return null;
  current.expiresAt = Date.now() + TTL_MS;
  return current;
}

export function ownsCapture(pageId: string, leaseId: string): boolean {
  const current = state().leases.get(leaseId);
  return Boolean(current && current.pageId === pageId && current.expiresAt > Date.now());
}

export function releaseCapture(pageId: string, leaseId?: string): void {
  if (!leaseId) return;
  const current = state().leases.get(leaseId);
  if (!current || current.pageId !== pageId) return;
  state().leases.delete(leaseId);
  state().clients.delete(clientKey(pageId, current.clientId));
}

export function releaseMeetingCaptures(meetingId: string): void {
  for (const [leaseId, lease] of state().leases) {
    if (lease.meetingId !== meetingId) continue;
    state().leases.delete(leaseId);
    state().clients.delete(clientKey(lease.pageId, lease.clientId));
  }
}
