import type { DealRole } from '@pactlab/domain';
import { getMe } from '../../../../lib/session';
import { dealsApi, type DealMember } from './api';

export interface DealViewer {
  readonly userId: string | null;
  /** The caller's role on this deal, or null when it cannot be read. */
  readonly role: DealRole | null;
  readonly members: readonly DealMember[];
  /** Display name for a user id, falling back to a short id. */
  name(userId: string | null | undefined): string;
}

/**
 * Who is looking at a deal and with which role. Drives which buttons are
 * shown; the API still decides every action.
 */
export async function dealViewer(dealId: string): Promise<DealViewer> {
  const [me, members] = await Promise.all([getMe(), dealsApi.members(dealId)]);
  const userId = me.kind === 'ok' ? me.data.user.id : null;
  const items = members.kind === 'ok' ? members.data.items : [];
  const names = new Map(items.map((member) => [member.userId, member.displayName]));
  const mine = items.find((member) => member.userId === userId && member.status === 'ACTIVE');
  return {
    userId,
    role: (mine?.role as DealRole | undefined) ?? null,
    members: items,
    name: (id) => (id ? (names.get(id) ?? `user ${id.slice(0, 8)}`) : 'Unknown'),
  };
}

const WRITERS: readonly DealRole[] = ['DEAL_LEAD', 'ANALYST'];
const DECIDERS: readonly DealRole[] = ['DEAL_LEAD', 'REVIEWER'];

/** Mirrors the API's rules for showing controls; never a substitute for them. */
export const can = {
  draft: (role: DealRole | null) => role !== null && WRITERS.includes(role),
  review: (role: DealRole | null) => role !== null && DECIDERS.includes(role),
  manageMembers: (role: DealRole | null) => role === 'DEAL_LEAD',
};
