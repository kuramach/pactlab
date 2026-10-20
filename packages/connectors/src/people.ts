import { createHash } from 'node:crypto';

/**
 * Pseudonymous, per-deal contributor key: the same identity in GitHub and
 * Jira yields the same key, so code and delivery activity join without the
 * analytics ever seeing a raw identity or a name.
 */
export function contributorKey(dealId: string, identity: string): string {
  return createHash('sha256').update(`${dealId}:${identity.trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

/** `YYYY-MM` of an ISO timestamp (UTC). */
export const monthOf = (iso: string) => iso.slice(0, 7);
