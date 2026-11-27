import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { promoCodes } from './billing';
import { OperatorRequiredError } from './ops';
import { pactQuotes, PricingStorageError, priceBooks, pricingPromos, type QuoteRecordInput, type StoredPriceBook } from './price-books';
import { startTestDatabase, type TestDatabase } from './testing';

const SEED = '019ac000-0000-7000-8000-000000000001';

/** T-177a: price books, pact promos and stored quotes at the database. */
describe('price books, promos and quotes (database)', () => {
  let db: TestDatabase;
  let operator = '';

  async function organization(label: string, role = 'ORG_OWNER') {
    const organizationId = newId();
    const userId = newId();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`, [organizationId, `${label} (synthetic)`, `${label.toLowerCase()}-${organizationId.slice(-8)}`]);
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, `pactlab|${userId}`, `${label} (synthetic)`, `${label.toLowerCase()}-${userId.slice(-6)}@example.test`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`, [newId(), organizationId, userId, role]);
    return { organizationId, userId };
  }

  async function deal(organizationId: string, userId: string) {
    const id = newId();
    await db.owner.query(`INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at) VALUES ($1, $2, 'Synthetic pact', 'Target (synthetic)', 'PRIVATE_ACQUIRER', $3, now())`, [id, organizationId, userId]);
    return id;
  }

  /** A $10M USD quote on `book`, as the engine itemizes it: $5,000 fixed + 5 bps on $10M. */
  const tenMillion = (book: StoredPriceBook, extra: Partial<QuoteRecordInput> = {}): QuoteRecordInput => ({
    versionId: book.id,
    currency: 'USD',
    enterpriseValue: '10000000.00',
    pilot: false,
    promoCode: null,
    promoId: null,
    promoRefusal: null,
    partnerCode: null,
    resellerPercent: null,
    subtotal: '10000.00',
    total: '10000.00',
    applied: 'NONE',
    includes: { documents: 1000, aiBudget: '100.00' },
    dealId: null,
    engineVersion: 'pricing-1',
    lines: [
      { kind: 'FIXED', from: null, upTo: null, bps: null, slice: null, percent: null, amount: book.fixedFee, applied: true },
      { kind: 'BAND', from: '0.00', upTo: '25000000.00', bps: '5', slice: '10000000.00', percent: null, amount: '5000.00', applied: true },
    ],
    ...extra,
  });

  beforeAll(async () => {
    db = await startTestDatabase();
    const ops = await organization('Pricing ops');
    operator = ops.userId;
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator]);
  }, 60_000);
  afterAll(async () => db?.stop());

  it('seeds USD v1 from the T-177 numbers; other markets have no book; the runtime role cannot touch the tables', async () => {
    const usd = await priceBooks.live(db.prisma, 'USD');
    expect(usd).toMatchObject({ id: SEED, currency: 'USD', version: 1, status: 'PUBLISHED', fixedFee: '5000.00', variableCap: '50000.00', pilotFlat: '5000.00', rounding: '0.01' });
    expect(usd?.bands).toEqual([
      { upTo: '25000000.00', bps: '5', includes: { documents: 1000, aiBudget: '100.00' } },
      { upTo: '100000000.00', bps: '2', includes: { documents: 2500, aiBudget: '250.00' } },
      { upTo: null, bps: '1', includes: { documents: 5000, aiBudget: '500.00' } },
    ]);
    for (const currency of ['GBP', 'EUR', 'JPY', 'INR']) expect(await priceBooks.live(db.prisma, currency)).toBeNull();
    for (const table of ['price_book_versions', 'price_book_bands', 'pricing_promos', 'pact_quotes', 'pact_quote_lines', 'pricing_promo_redemptions', 'pricing_promo_changes']) {
      await expect(db.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE pactlab_app');
        return tx.$queryRawUnsafe(`SELECT 1 FROM ${table} LIMIT 1`);
      })).rejects.toThrow(/permission denied/i);
    }
  });

  it('a published version never changes, even for the schema owner; a draft from it publishes as the next version', async () => {
    await expect(db.owner.query(`UPDATE price_book_versions SET fixed_fee = 1 WHERE id = $1`, [SEED])).rejects.toThrow(/VERSION_PUBLISHED/);
    await expect(db.owner.query(`UPDATE price_book_bands SET bps = 9 WHERE version_id = $1`, [SEED])).rejects.toThrow(/VERSION_PUBLISHED/);
    await expect(db.owner.query(`DELETE FROM price_book_versions WHERE id = $1`, [SEED])).rejects.toThrow(/VERSION_PUBLISHED/);

    const seed = (await priceBooks.live(db.prisma, 'USD'))!;
    await expect(priceBooks.updateDraft(db.prisma, operator, SEED, seed)).rejects.toEqual(new PricingStorageError('VERSION_PUBLISHED'));
    const outsider = await organization('Outsider');
    await expect(priceBooks.createDraft(db.prisma, outsider.userId, seed, { basedOnVersionId: SEED, suggestedFrom: null })).rejects.toBeInstanceOf(OperatorRequiredError);

    const draft = await priceBooks.createDraft(db.prisma, operator, { ...seed, fixedFee: '6000' }, { basedOnVersionId: SEED, suggestedFrom: null });
    await expect(priceBooks.createDraft(db.prisma, operator, seed, { basedOnVersionId: SEED, suggestedFrom: null })).rejects.toEqual(new PricingStorageError('DRAFT_EXISTS'));
    expect(await priceBooks.get(db.prisma, operator, draft)).toMatchObject({ version: 2, status: 'DRAFT', effectiveFrom: null, fixedFee: '6000.00', basedOnVersionId: SEED });
    await expect(priceBooks.publish(db.prisma, operator, draft, new Date(Date.now() - 86_400_000))).rejects.toEqual(new PricingStorageError('BACKDATED'));
    expect(await priceBooks.discardDraft(db.prisma, operator, draft)).toBe(true);
    expect(await priceBooks.get(db.prisma, operator, draft)).toBeNull();
  });

  it('a quote binds the live version and re-reads unchanged after a new version is published; another organization reads nothing', async () => {
    const ana = await organization('Ana');
    const usd = (await priceBooks.live(db.prisma, 'USD'))!;
    const id = await pactQuotes.record(db.prisma, ana.organizationId, ana.userId, tenMillion(usd));
    const before = await pactQuotes.get(db.prisma, ana.organizationId, id);
    expect(before).toMatchObject({ bookVersionId: SEED, bookVersion: 1, subtotal: '10000.00', total: '10000.00', status: 'OPEN', enterpriseValue: '10000000.00' });
    expect(new Date(before!.expiresAt).getTime() - new Date(before!.createdAt).getTime()).toBe(30 * 86_400_000);
    expect((await priceBooks.get(db.prisma, operator, SEED))?.firstQuotedAt).not.toBeNull();

    const draft = await priceBooks.createDraft(db.prisma, operator, { ...usd, fixedFee: '7000' }, { basedOnVersionId: SEED, suggestedFrom: null });
    const v2 = await priceBooks.publish(db.prisma, operator, draft, null);
    expect((await priceBooks.live(db.prisma, 'USD'))?.id).toBe(v2.id);
    expect(await pactQuotes.get(db.prisma, ana.organizationId, id)).toEqual(before);

    // The old version no longer prices fresh quotes; the footing is checked against the version.
    await expect(pactQuotes.record(db.prisma, ana.organizationId, ana.userId, tenMillion(usd))).rejects.toEqual(new PricingStorageError('NOT_LIVE_BOOK'));
    await expect(pactQuotes.record(db.prisma, ana.organizationId, ana.userId, tenMillion(v2))).rejects.toEqual(new PricingStorageError('QUOTE_DOES_NOT_FOOT'));
    expect(await pactQuotes.record(db.prisma, ana.organizationId, ana.userId, tenMillion(v2, { subtotal: '12000.00', total: '12000.00' }))).toMatch(/[0-9a-f-]{36}/);

    const bo = await organization('Bo');
    expect(await pactQuotes.get(db.prisma, bo.organizationId, id)).toBeNull();
    const member = await organization('Member', 'MEMBER');
    await expect(pactQuotes.record(db.prisma, member.organizationId, member.userId, tenMillion(v2, { subtotal: '12000.00', total: '12000.00' }))).rejects.toEqual(new PricingStorageError('FORBIDDEN'));
    await expect(db.owner.query(`UPDATE pact_quotes SET total = 1 WHERE id = $1`, [id])).rejects.toThrow(/QUOTE_FROZEN/);
  });

  it('promos: one code namespace with T-087; a cap holds at purchase; effect is frozen once used; every change is kept', async () => {
    await promoCodes.create(db.prisma, operator, { code: 'SHARED-CODE', description: 'Org promo', kind: 'FREE_PACTS', percentOff: null, amountOff: null, currency: null, duration: null, durationMonths: null, planKeys: [], freePacts: 1, packs: [], validFrom: null, validUntil: null, maxRedemptions: null, skipsApproval: true });
    const base = { description: 'Launch', effect: 'PERCENT_TOTAL' as const, percent: '10', amount: null, pilotFlat: null, currency: null, markets: [], stackable: false, scope: 'ANY' as const, organizationIds: [], validFrom: null, validUntil: null, maxRedemptions: 1, maxPerOrganization: 1 };
    await expect(pricingPromos.create(db.prisma, operator, { ...base, code: 'SHARED-CODE' })).rejects.toEqual(new PricingStorageError('PROMO_CODE_TAKEN'));
    const promoId = await pricingPromos.create(db.prisma, operator, { ...base, code: 'TEN-OFF' });
    await expect(promoCodes.create(db.prisma, operator, { code: 'TEN-OFF', description: 'x', kind: 'FREE_PACTS', percentOff: null, amountOff: null, currency: null, duration: null, durationMonths: null, planKeys: [], freePacts: 1, packs: [], validFrom: null, validUntil: null, maxRedemptions: null, skipsApproval: true })).rejects.toThrow(/promo_codes_code_key/);

    const usd = (await priceBooks.live(db.prisma, 'USD'))!;
    const withPromo = (extra: Partial<QuoteRecordInput> = {}) => {
      const base = tenMillion(usd);
      const subtotal = (Number(usd.fixedFee) + 5000).toFixed(2);
      const off = (Number(subtotal) / 10).toFixed(2);
      return { ...base, subtotal, total: (Number(subtotal) - Number(off)).toFixed(2), applied: 'PROMO' as const, promoCode: 'TEN-OFF', promoId, lines: [...base.lines, { kind: 'PROMO' as const, from: null, upTo: null, bps: null, slice: null, percent: null, amount: off, applied: true }], ...extra };
    };
    const ana = await organization('Cap A');
    const bo = await organization('Cap B');
    const quoteA = await pactQuotes.record(db.prisma, ana.organizationId, ana.userId, withPromo());
    const quoteB = await pactQuotes.record(db.prisma, bo.organizationId, bo.userId, withPromo());
    expect((await pricingPromos.check(db.prisma, ana.organizationId, 'ten-off', 'ip')).reason).toBe('OK');
    expect(await pactQuotes.consume(db.prisma, ana.organizationId, quoteA, await deal(ana.organizationId, ana.userId))).toBe('CONSUMED');
    expect(await pactQuotes.consume(db.prisma, ana.organizationId, quoteA, await deal(ana.organizationId, ana.userId))).toBe('NOT_OPEN');
    expect(await pactQuotes.consume(db.prisma, bo.organizationId, quoteB, await deal(bo.organizationId, bo.userId))).toBe('PROMO_USED_UP');
    expect((await pricingPromos.check(db.prisma, bo.organizationId, 'TEN-OFF', 'ip')).reason).toBe('USED_UP');

    await expect(pricingPromos.update(db.prisma, operator, promoId, { effect: 'PERCENT_TOTAL', percent: '50' })).rejects.toEqual(new PricingStorageError('PROMO_IN_USE'));
    expect(await pricingPromos.update(db.prisma, operator, promoId, { maxRedemptions: 5, status: 'PAUSED' })).toMatchObject({ maxRedemptions: 5, status: 'PAUSED', redemptions: 1, byMarket: [{ currency: 'USD', uses: 1 }] });
    expect((await pricingPromos.check(db.prisma, bo.organizationId, 'TEN-OFF', 'ip')).reason).toBe('PAUSED');
    const changes = (await db.owner.query(`SELECT before->>'status' AS was, after->>'status' AS now FROM pricing_promo_changes WHERE promo_id = $1`, [promoId])).rows;
    expect(changes).toEqual([{ was: 'ACTIVE', now: 'PAUSED' }]);
    const redemptions = await pricingPromos.redemptions(db.prisma, operator, promoId, { limit: 10 });
    expect(redemptions).toMatchObject({ total: 1, items: [{ organizationId: ana.organizationId, currency: 'USD', amountForgone: '1200.00' }] });
  });
});
