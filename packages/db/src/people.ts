import type { ObservedPerson } from '@pactlab/domain';
import type { TransactionClient } from './client';

export interface ContributorIdentityRecord {
  contributorKey: string;
  system: 'github' | 'jira';
  identity: string;
  displayName: string | null;
  status: 'CURRENT' | 'DEPARTED' | 'UNKNOWN';
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface PeopleAccessRecord {
  id: string;
  enabled: boolean;
  basis: string;
  decidedBy: string;
  decidedAt: Date;
}

/**
 * The gated contributor directory. Raw identities and names live only here;
 * evidence carries pseudonymous keys. Callers decide whether names may be
 * shown (the names gate) and audit every read that returns them.
 */
export const contributorDirectory = {
  /** Record people seen by a sync: new identities are added; names, status and last seen refresh. */
  async upsert(tx: TransactionClient, scope: { organizationId: string; dealId: string }, people: readonly ObservedPerson[]): Promise<number> {
    let written = 0;
    for (const person of people) {
      await tx.contributorIdentity.upsert({
        where: {
          organizationId_dealId_system_identity: { organizationId: scope.organizationId, dealId: scope.dealId, system: person.system, identity: person.identity },
        },
        create: {
          organizationId: scope.organizationId,
          dealId: scope.dealId,
          contributorKey: person.contributorKey,
          system: person.system,
          identity: person.identity,
          displayName: person.displayName,
          status: person.status,
        },
        update: {
          displayName: person.displayName,
          // A Jira sighting never downgrades a status the repository identity map supplied.
          ...(person.status !== 'UNKNOWN' ? { status: person.status } : {}),
          lastSeenAt: new Date(),
        },
      });
      written += 1;
    }
    return written;
  },

  async list(tx: TransactionClient, dealId: string): Promise<ContributorIdentityRecord[]> {
    const rows = await tx.contributorIdentity.findMany({
      where: { dealId },
      select: { contributorKey: true, system: true, identity: true, displayName: true, status: true, firstSeenAt: true, lastSeenAt: true },
      orderBy: [{ firstSeenAt: 'asc' }, { identity: 'asc' }],
    });
    return rows as ContributorIdentityRecord[];
  },
};

/** The per-deal names gate. Append-only; the newest decision applies. */
export const peopleAccess = {
  async history(tx: TransactionClient, dealId: string): Promise<PeopleAccessRecord[]> {
    return tx.peopleAccess.findMany({
      where: { dealId },
      select: { id: true, enabled: true, basis: true, decidedBy: true, decidedAt: true },
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
    });
  },

  async record(
    tx: TransactionClient,
    input: { organizationId: string; dealId: string; enabled: boolean; basis: string; decidedBy: string },
  ): Promise<PeopleAccessRecord> {
    return tx.peopleAccess.create({ data: input, select: { id: true, enabled: true, basis: true, decidedBy: true, decidedAt: true } });
  },
};
