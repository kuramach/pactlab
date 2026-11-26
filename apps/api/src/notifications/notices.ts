import type { PactEventInput } from '@pactlab/db';
import type { DealRole } from '@pactlab/domain';

/**
 * Notices shared by more than one place (T-145). Each names who may hear of it by the same rule as
 * the pact's own visibility: an investor's seat is buyer-only; a bidder is seen only by the pact's
 * own side and their own bid's colleagues.
 */
export function memberAddedNotice(member: { userId: string; role: DealRole; bidId?: string | null }, key: string): PactEventInput | null {
  if (member.role === 'INVESTOR') return null;
  return { type: 'MEMBER_ADDED', dedupeKey: `member:${member.userId}:${key}`, visibility: 'SHARED', audience: member.role === 'BIDDER' ? 'OWN_SIDE' : 'ALL', bidId: member.bidId ?? null };
}

/**
 * A document from the other side (digest): the seller's upload to the buyer's team, or a document the
 * own side shared to the seller. A document the own side keeps to itself is nobody else's news.
 */
export function documentAddedNotice(document: { id: string; visibility: 'SHARED' | 'BUYER_ONLY' }, uploaderRole: DealRole): PactEventInput | null {
  if (document.visibility !== 'SHARED') return null;
  const fromCounterparty = uploaderRole === 'TARGET_CONTRIBUTOR';
  return { type: 'DOCUMENT_ADDED', dedupeKey: `document:${document.id}:added`, visibility: 'SHARED', audience: fromCounterparty ? 'OWN_SIDE' : 'COUNTERPARTY' };
}
