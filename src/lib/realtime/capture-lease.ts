import { randomUUID } from "node:crypto";

/** 한 언어 수집 페이지에서 같은 음원을 두 번 전사하지 않게 하는 짧은 활성권. */
const TTL_MS = 20_000;

type Lease = {
  meetingId: string;
  pageId: string;
  clientId: string;
  leaseId: string;
  expiresAt: number;
};

type LeaseState = { leases: Map<string, Lease> };

const shared = globalThis as unknown as { __captureLeases?: LeaseState };

function state(): LeaseState {
  return (shared.__captureLeases ??= { leases: new Map() });
}

export function claimCapture(meetingId: string, pageId: string, clientId: string): Lease | null {
  const now = Date.now();
  const current = state().leases.get(pageId);
  if (current && current.expiresAt > now && current.clientId !== clientId) return null;

  const lease: Lease = {
    meetingId,
    pageId,
    clientId,
    leaseId: current?.clientId === clientId ? current.leaseId : randomUUID(),
    expiresAt: now + TTL_MS,
  };
  state().leases.set(pageId, lease);
  return lease;
}

export function renewCapture(pageId: string, leaseId: string): Lease | null {
  const current = state().leases.get(pageId);
  if (!current || current.leaseId !== leaseId || current.expiresAt <= Date.now()) return null;
  current.expiresAt = Date.now() + TTL_MS;
  return current;
}

export function ownsCapture(pageId: string, leaseId: string): boolean {
  const current = state().leases.get(pageId);
  return Boolean(current && current.leaseId === leaseId && current.expiresAt > Date.now());
}

export function releaseCapture(pageId: string, leaseId?: string): void {
  const current = state().leases.get(pageId);
  if (current && (!leaseId || current.leaseId === leaseId)) state().leases.delete(pageId);
}

export function releaseMeetingCaptures(meetingId: string): void {
  for (const [pageId, lease] of state().leases) {
    if (lease.meetingId === meetingId) state().leases.delete(pageId);
  }
}
