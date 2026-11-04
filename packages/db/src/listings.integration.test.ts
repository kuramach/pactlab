import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createPrismaClient, type PrismaClient } from './client';
import { publicListings } from './listings';
import { createSyntheticTenant, type SyntheticTenant } from './testing/tenants';

/**
 * Public deal pages against a real PostgreSQL server, called as the runtime login role
 * (the API's path): a signed-out visitor sees only a published teaser, files a request,
 * and confirms it; the request reaches the audit trail of that pact only.
 */
const runtimeUrl = process.env['DATABASE_URL'];
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];
const slug = () => `pl-${randomBytes(8).toString('hex').slice(0, 10)}`;

describe.runIf(runtimeUrl && ownerUrl)('public listing functions against PostgreSQL', () => {
  let prisma: PrismaClient;
  let owner: pg.Client;
  let seller: SyntheticTenant;
  const published = slug();
  const draft = slug();

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl, options: '-c TimeZone=UTC' });
    await owner.connect();
    seller = await createSyntheticTenant(owner, `Seller${Date.now()}`);
    const second = await createSyntheticTenant(owner, `Seller2${Date.now()}`);
    const insert = (tenant: SyntheticTenant, value: string, status: string, visibility: string, name: string | null) =>
      owner.query(
        `INSERT INTO deal_listings (id, organization_id, deal_id, slug, status, visibility, codename, public_name, headline, summary, highlights, created_by, updated_by, published_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, 'Project Atlas', $6, 'Profitable workflow SaaS', 'Synthetic teaser', ARRAY['ARR growing'], $7, $7, now())`,
        [tenant.organizationId, tenant.dealId, value, status, visibility, name, tenant.userId],
      );
    await insert(seller, published, 'PUBLISHED', 'ANONYMOUS', null);
    await insert(second, draft, 'DRAFT', 'NAMED', 'Synthetic Co');
    prisma = createPrismaClient({ connectionString: runtimeUrl ?? '' });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await owner?.end();
  });

  it('shows a published teaser and nothing for a draft; never the pact id', async () => {
    const teaser = await publicListings.get(prisma, published);
    expect(teaser).toMatchObject({ codename: 'Project Atlas', visibility: 'ANONYMOUS', publicName: null, highlights: ['ARR growing'] });
    expect(JSON.stringify(teaser)).not.toContain(seller.dealId);
    expect(await publicListings.get(prisma, draft)).toBeNull();
    expect(await publicListings.get(prisma, 'pl-0000000000')).toBeNull();
  });

  it('files one open request per address, confirms it once, and audits it on that pact', async () => {
    const ip = `ip-${Date.now()}`;
    const token = `tok-${Date.now()}`;
    const input = { slug: published, name: 'Ari Buyer', firm: 'Synthetic Capital', email: `Ari.${Date.now()}@example.com`, intent: 'FINANCIAL', message: 'Interested', ipHash: ip, tokenHash: token };
    expect(await publicListings.fileInterest(prisma, input)).toBe(true);
    // The same address again while it is open: refused (silently, by the caller).
    expect(await publicListings.fileInterest(prisma, { ...input, tokenHash: `${token}-2` })).toBe(false);
    // Not for a draft listing.
    expect(await publicListings.fileInterest(prisma, { ...input, slug: draft, tokenHash: `${token}-3` })).toBe(false);

    expect(await publicListings.confirmInterest(prisma, token)).toBe(published);
    expect(await publicListings.confirmInterest(prisma, token)).toBeNull();
    const stored = await owner.query(`SELECT status, email FROM listing_interests WHERE deal_id = $1`, [seller.dealId]);
    expect(stored.rows).toEqual([{ status: 'NEW', email: input.email.toLowerCase() }]);
    const audit = await owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'listing.interest.received'`, [seller.dealId]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('rate-limits one address on one listing', async () => {
    const ip = `ip-limit-${Date.now()}`;
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await publicListings.fileInterest(prisma, { slug: published, name: 'Rate Test', firm: 'Synthetic', email: `rate${index}.${Date.now()}@example.com`, intent: 'STRATEGIC', message: null, ipHash: ip, tokenHash: `rate-${index}-${Date.now()}` }));
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it('gives the runtime role no direct reads without a tenant', async () => {
    await expect(prisma.$queryRawUnsafe('SELECT count(*) FROM listing_interests')).rejects.toThrow(/permission denied/);
  });
});
