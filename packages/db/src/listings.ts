import type { PrismaClient, TransactionClient } from './client';
import { APP_DB_ROLE } from './tenant';

/**
 * Public deal pages (listings): what a signed-out visitor may see and do runs through
 * SECURITY DEFINER functions owned by `pactlab_public`. These wrappers call them as
 * `pactlab_app` with no tenant context. The seller's side uses ordinary RLS queries.
 */
async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

/** A published listing's teaser: seller-written text only. */
export interface PublicListingRow {
  slug: string;
  visibility: 'ANONYMOUS' | 'NAMED';
  codename: string;
  /** Present only when the seller chose to show a name. */
  publicName: string | null;
  headline: string;
  sector: string | null;
  region: string | null;
  sizeBand: string | null;
  askingLow: string | null;
  askingHigh: string | null;
  askingCurrency: string | null;
  summary: string;
  highlights: string[];
  indexable: boolean;
  publishedAt: Date | null;
}

export const publicListings = {
  /** The teaser of a published listing; null for an unknown, draft or closed one. */
  async get(prisma: PrismaClient, slug: string): Promise<PublicListingRow | null> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<Record<string, unknown>[]>`SELECT * FROM app_listing_public(${slug})`,
    );
    if (!row) return null;
    return {
      slug: String(row['slug']),
      visibility: row['visibility'] === 'NAMED' ? 'NAMED' : 'ANONYMOUS',
      codename: String(row['codename']),
      publicName: (row['public_name'] as string | null) ?? null,
      headline: String(row['headline']),
      sector: (row['sector'] as string | null) ?? null,
      region: (row['region'] as string | null) ?? null,
      sizeBand: (row['size_band'] as string | null) ?? null,
      askingLow: (row['asking_low'] as string | null) ?? null,
      askingHigh: (row['asking_high'] as string | null) ?? null,
      askingCurrency: (row['asking_currency'] as string | null) ?? null,
      summary: String(row['summary'] ?? ''),
      highlights: (row['highlights'] as string[] | null) ?? [],
      indexable: row['indexable'] === true,
      publishedAt: row['published_at'] ? new Date(row['published_at'] as string) : null,
    };
  },

  /** Record a request for access. True when recorded; false otherwise. Callers respond identically. */
  async fileInterest(
    prisma: PrismaClient,
    input: { slug: string; name: string; firm: string; email: string; intent: string; message: string | null; ipHash: string; tokenHash: string },
  ): Promise<boolean> {
    const [row] = await asApp(prisma, (tx) =>
      tx.$queryRaw<{ ok: boolean }[]>`
        SELECT app_listing_interest_file(${input.slug}, ${input.name}, ${input.firm}, ${input.email}, ${input.intent}, ${input.message}, ${input.ipHash}, ${input.tokenHash}) AS ok`,
    );
    return row?.ok === true;
  },

  /** Confirm a request's email address. The listing's slug when confirmed; null otherwise. */
  async confirmInterest(prisma: PrismaClient, tokenHash: string): Promise<string | null> {
    const [row] = await asApp(prisma, (tx) => tx.$queryRaw<{ slug: string }[]>`SELECT * FROM app_listing_interest_confirm(${tokenHash})`);
    return row?.slug ?? null;
  },
};
