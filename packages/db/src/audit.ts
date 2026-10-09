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

export interface AuditEventView {
  id: string;
  sequence: string;
  occurredAt: Date;
  action: string;
  outcome: string;
  targetType: string;
  targetId: string | null;
  dealId: string | null;
  dealName: string | null;
  actorUserId: string | null;
  actorName: string | null;
}

/**
 * Newest-first audit trail for the organization. RLS limits rows to
 * organization-level events and deals the reader belongs to. IP addresses
 * and request ids stay out of the view.
 */
export const auditEvents = {
  async list(
    tx: TransactionClient,
    options: { before?: bigint; limit: number; dealId?: string },
  ): Promise<{ items: AuditEventView[]; nextBefore: string | null }> {
    const rows = await tx.auditEvent.findMany({
      where: {
        ...(options.before !== undefined ? { chainSeq: { lt: options.before } } : {}),
        ...(options.dealId ? { dealId: options.dealId } : {}),
      },
      orderBy: { chainSeq: 'desc' },
      take: options.limit + 1,
      select: {
        id: true,
        chainSeq: true,
        occurredAt: true,
        action: true,
        outcome: true,
        targetType: true,
        targetId: true,
        dealId: true,
        actorUserId: true,
        deal: { select: { name: true } },
      },
    });
    const page = rows.slice(0, options.limit);
    const actorIds = [...new Set(page.map((row) => row.actorUserId).filter((id): id is string => id !== null))];
    const actors = actorIds.length
      ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })
      : [];
    const names = new Map(actors.map((actor) => [actor.id, actor.displayName]));
    return {
      items: page.map(({ chainSeq, deal, ...row }) => ({
        ...row,
        sequence: chainSeq.toString(),
        dealName: deal?.name ?? null,
        actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
      })),
      nextBefore: rows.length > options.limit ? (page.at(-1)?.chainSeq.toString() ?? null) : null,
    };
  },
};
