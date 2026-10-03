import { createHash } from 'node:crypto';
import type { Prisma, TransactionClient } from './client';

export type AuditOutcome = 'ALLOWED' | 'DENIED' | 'SUCCEEDED' | 'FAILED';

export interface AuditEventInput {
  organizationId: string;
  dealId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome: AuditOutcome;
  requestId?: string | null;
  ipAddress?: string | null;
}

/** Append an audit event. Chain fields are assigned by the database trigger. */
export async function appendAuditEvent(tx: TransactionClient, event: AuditEventInput) {
  return tx.auditEvent.create({
    data: {
      organizationId: event.organizationId,
      dealId: event.dealId ?? null,
      actorUserId: event.actorUserId ?? null,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      outcome: event.outcome,
      requestId: event.requestId ?? null,
      ipAddress: event.ipAddress ?? null,
    },
  });
}

interface ChainedEvent {
  id: string;
  organizationId: string;
  dealId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: string;
  requestId: string | null;
  occurredAt: Date;
  chainSeq: bigint;
  prevHash: string | null;
  hash: string;
}

/** Recompute one chain (ordered by chainSeq) and report the first broken link. */
export function verifyAuditChain(events: readonly ChainedEvent[]): { valid: true } | { valid: false; brokenAt: string } {
  let previous: string | null = null;
  for (const event of events) {
    const material = [
      event.prevHash ?? '',
      event.chainSeq.toString(),
      event.id,
      event.organizationId,
      event.dealId ?? '',
      event.actorUserId ?? '',
      event.action,
      event.targetType,
      event.targetId ?? '',
      event.outcome,
      event.requestId ?? '',
      event.occurredAt.toISOString(),
    ].join('|');
    const expected = createHash('sha256').update(material, 'utf8').digest('hex');
    if (event.prevHash !== previous || event.hash !== expected) return { valid: false, brokenAt: event.id };
    previous = event.hash;
  }
  return { valid: true };
}

/** Enqueue a domain event in the same transaction as the state change. */
export async function enqueueOutboxEvent(
  tx: TransactionClient,
  event: {
    organizationId: string;
    dealId?: string | null;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Prisma.InputJsonValue;
    idempotencyKey: string;
  },
) {
  return tx.outboxEvent.create({ data: { ...event, dealId: event.dealId ?? null } });
}
