import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { billing, promoCodes } from './billing';
import { startTestDatabase, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** T-087: billing and promo-code state at the database. */
describe('billing (database)', () => {
  let db: TestDatabase;
  let operator = '';

  async function organization(label: string) {
    const organizationId = newId();
    const userId = newId();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`, [organizationId, `${label} (synthetic)`, `${label.toLowerCase()}-${organizationId.slice(-8)}`]);
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, `pactlab|${userId}`, `${label} (synthetic)`, `${label.toLowerCase()}-${userId.slice(-6)}@example.test`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_OWNER')`, [newId(), organizationId, userId]);
    return { organizationId, userId };
  }

  async function deal(organizationId: string, userId: string) {
    const id = newId();
    await db.owner.query(
      `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at) VALUES ($1, $2, 'Synthetic pact', 'Target (synthetic)', 'PRIVATE_ACQUIRER', $3, now())`,
      [id, organizationId, userId],
    );
    return id;
  }

  const consume = (organizationId: string, dealId: string, enforce = true, companyType = 'SOFTWARE_SAAS', kind: 'PACT' | 'VENTURE_ROUND' = 'PACT') =>
    db.prisma.$transaction((tx) => billing.consume(tx, { organizationId, dealId, kind, companyType, enforce }));

  beforeAll(async () => {
    db = await startTestDatabase();
    const ops = await organization('Pactlab ops');
    operator = ops.userId;
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator]);
  }, 60_000);
  afterAll(async () => db?.stop());

  it('seeds the launch price book from ADR 0025', async () => {
    const plans = await billing.plans(db.prisma);
    expect(plans.find((plan) => plan.key === 'PACT')).toMatchObject({ kind: 'ONE_TIME', amount: '2500.00', grants: 'PACT', selfServe: true });
    expect(plans.find((plan) => plan.key === 'TEAM_ANNUAL')).toMatchObject({ kind: 'SUBSCRIPTION', interval: 'year', amount: '18000.00', pactsIncluded: 10, overageAmount: '1500.00' });
    expect(plans.find((plan) => plan.key === 'FIRM_ANNUAL')?.selfServe).toBe(false);
  });

  it('a purchase grants one credit once; a replayed event grants nothing; a pact consumes it', async () => {
    const ana = await organization('Ana');
    expect(await billing.beginEvent(db.prisma, 'evt_1', 'checkout.session.completed')).toBe(true);
    expect(await billing.beginEvent(db.prisma, 'evt_1', 'checkout.session.completed')).toBe(false);
    expect(await billing.grantPurchase(db.prisma, ana.organizationId, 'PACT', 'evt_1')).toBe(true);
    expect(await billing.grantPurchase(db.prisma, ana.organizationId, 'PACT', 'evt_1')).toBe(false);
    expect((await billing.state(db.prisma, ana.organizationId, ana.userId))?.credits).toHaveLength(1);
    expect(await consume(ana.organizationId, await deal(ana.organizationId, ana.userId))).toBe('CREDIT');
    expect(await consume(ana.organizationId, await deal(ana.organizationId, ana.userId))).toBeNull();
    // Enforcement off: never blocked.
    expect(await consume(ana.organizationId, await deal(ana.organizationId, ana.userId), false)).toBe('FREE');
  });

  it('pilot organizations are never charged', async () => {
    const pilot = await organization('Pilot');
    await db.owner.query(`INSERT INTO organization_flags (organization_id, pilot_mode) VALUES ($1, true)`, [pilot.organizationId]);
    expect(await consume(pilot.organizationId, await deal(pilot.organizationId, pilot.userId))).toBe('PILOT');
  });

  it('a Team subscription covers 10 pacts a period; past due stops new ones; a new period resets', async () => {
    const team = await organization('Team');
    const end = new Date(Date.now() + 30 * 86_400_000);
    expect(await billing.setSubscription(db.prisma, { organizationId: team.organizationId, customerId: 'cus_team', subscriptionId: 'sub_team', planKey: 'TEAM_ANNUAL', status: 'ACTIVE', periodStart: new Date(), periodEnd: end, newPeriod: true })).toBe(true);
    for (let i = 0; i < 10; i += 1) expect(await consume(team.organizationId, await deal(team.organizationId, team.userId))).toBe('ALLOWANCE');
    expect(await consume(team.organizationId, await deal(team.organizationId, team.userId))).toBeNull();
    // Found by subscription id alone (as from a webhook): past due.
    await billing.setSubscription(db.prisma, { organizationId: null, customerId: null, subscriptionId: 'sub_team', planKey: null, status: 'PAST_DUE', periodStart: null, periodEnd: null, newPeriod: false });
    expect((await billing.state(db.prisma, team.organizationId, team.userId))?.status).toBe('PAST_DUE');
    await billing.setSubscription(db.prisma, { organizationId: null, customerId: 'cus_team', subscriptionId: 'sub_team', planKey: null, status: 'ACTIVE', periodStart: new Date(), periodEnd: end, newPeriod: true });
    expect(await consume(team.organizationId, await deal(team.organizationId, team.userId))).toBe('ALLOWANCE');
    const audit = await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE organization_id = $1 AND action = 'billing.credit_consumed'`, [team.organizationId]);
    expect(audit.rows).toEqual([{ n: 11 }]);
  });

  it('billing state only for members of the organization', async () => {
    const one = await organization('One');
    const two = await organization('Two');
    expect(await billing.state(db.prisma, one.organizationId, two.userId)).toBeNull();
    expect(await billing.state(db.prisma, one.organizationId, one.userId)).toMatchObject({ status: 'NONE', credits: [] });
  });

  it('operators comp credits (audited); others cannot', async () => {
    const cy = await organization('Cy');
    await expect(billing.comp(db.prisma, cy.userId, cy.organizationId, 'PACT', [])).rejects.toThrow();
    await billing.comp(db.prisma, operator, cy.organizationId, 'PACT', ['MULTIFAMILY']);
    const comped = await db.owner.query(`SELECT 1 FROM audit_events WHERE organization_id = $1 AND action = 'billing.credit_comped'`, [cy.organizationId]);
    expect(comped.rows).toHaveLength(1);
    // A pack-limited credit pays only for that pack.
    expect(await consume(cy.organizationId, await deal(cy.organizationId, cy.userId), true, 'SOFTWARE_SAAS')).toBeNull();
    expect(await consume(cy.organizationId, await deal(cy.organizationId, cy.userId), true, 'MULTIFAMILY')).toBe('CREDIT');
  });

  it('free-pact promo codes: window, limits, once per organization, packs; discount codes wait for checkout', async () => {
    const ip = hash('198.51.100.40');
    await promoCodes.create(db.prisma, operator, { code: 'mf-launch', description: 'Multifamily launch', kind: 'FREE_PACTS', percentOff: null, amountOff: null, currency: null, duration: null, durationMonths: null, planKeys: [], freePacts: 2, packs: ['MULTIFAMILY'], validFrom: null, validUntil: null, maxRedemptions: 2, skipsApproval: true });
    expect(await promoCodes.check(db.prisma, 'MF-LAUNCH', ip)).toMatchObject({ reason: 'OK', kind: 'FREE_PACTS', skipsApproval: true, freePacts: 2, packs: ['MULTIFAMILY'] });
    const dee = await organization('Dee');
    expect(await promoCodes.redeem(db.prisma, 'mf-launch', dee.organizationId, dee.userId)).toBe('REDEEMED');
    expect(await promoCodes.redeem(db.prisma, 'mf-launch', dee.organizationId, dee.userId)).toBe('ALREADY');
    expect((await billing.state(db.prisma, dee.organizationId, dee.userId))?.credits).toHaveLength(2);
    expect(await consume(dee.organizationId, await deal(dee.organizationId, dee.userId), true, 'HOTELS')).toBeNull();
    expect(await consume(dee.organizationId, await deal(dee.organizationId, dee.userId), true, 'MULTIFAMILY')).toBe('CREDIT');
    const eve = await organization('Eve');
    expect(await promoCodes.redeem(db.prisma, 'mf-launch', eve.organizationId, eve.userId)).toBe('REDEEMED');
    const fay = await organization('Fay');
    expect(await promoCodes.redeem(db.prisma, 'mf-launch', fay.organizationId, fay.userId)).toBe('USED_UP');

    await promoCodes.create(db.prisma, operator, { code: 'PARTNER50', description: 'Design partners', kind: 'DISCOUNT', percentOff: '50', amountOff: null, currency: null, duration: 'REPEATING', durationMonths: 12, planKeys: ['TEAM_ANNUAL'], freePacts: null, packs: [], validFrom: null, validUntil: null, maxRedemptions: null, skipsApproval: true });
    const list = await promoCodes.list(db.prisma, operator);
    const partner = list.find((code) => code.code === 'PARTNER50')!;
    await promoCodes.setStripe(db.prisma, operator, partner.id, 'promo_test_123');
    expect(await promoCodes.redeem(db.prisma, 'PARTNER50', fay.organizationId, fay.userId)).toBe('REDEEMED');
    expect(await billing.checkoutDiscount(db.prisma, fay.organizationId, 'TEAM_ANNUAL')).toBe('promo_test_123');
    expect(await billing.checkoutDiscount(db.prisma, fay.organizationId, 'PACT')).toBeNull();
    expect(await promoCodes.deactivate(db.prisma, operator, partner.id)).toBe(true);
    expect((await promoCodes.check(db.prisma, 'PARTNER50', ip)).reason).toBe('INACTIVE');
  });

  it('expired and not-yet codes are refused; wrong guesses hit the per-address limit', async () => {
    await promoCodes.create(db.prisma, operator, { code: 'OLD-CODE', description: 'Expired', kind: 'FREE_PACTS', percentOff: null, amountOff: null, currency: null, duration: null, durationMonths: null, planKeys: [], freePacts: 1, packs: [], validFrom: new Date(Date.now() - 2 * 86_400_000), validUntil: new Date(Date.now() - 86_400_000), maxRedemptions: null, skipsApproval: true });
    await promoCodes.create(db.prisma, operator, { code: 'SOON-CODE', description: 'Later', kind: 'FREE_PACTS', percentOff: null, amountOff: null, currency: null, duration: null, durationMonths: null, planKeys: [], freePacts: 1, packs: [], validFrom: new Date(Date.now() + 86_400_000), validUntil: null, maxRedemptions: null, skipsApproval: true });
    const ip = hash('203.0.113.77');
    expect((await promoCodes.check(db.prisma, 'OLD-CODE', ip)).reason).toBe('EXPIRED');
    expect((await promoCodes.check(db.prisma, 'SOON-CODE', ip)).reason).toBe('NOT_YET');
    for (let i = 0; i < 18; i += 1) await promoCodes.check(db.prisma, `GUESS-${i}`, ip);
    expect((await promoCodes.check(db.prisma, 'MF-LAUNCH', ip)).reason).toBe('RATE_LIMITED');
    // Only operators make codes.
    const gus = await organization('Gus');
    await expect(promoCodes.create(db.prisma, gus.userId, { code: 'SNEAKY', description: 'x', kind: 'FREE_PACTS', percentOff: null, amountOff: null, currency: null, duration: null, durationMonths: null, planKeys: [], freePacts: 5, packs: [], validFrom: null, validUntil: null, maxRedemptions: null, skipsApproval: true })).rejects.toThrow();
  });

  it('the runtime role cannot touch billing tables directly', async () => {
    for (const table of ['billing_accounts', 'pact_credits', 'promo_codes', 'promo_redemptions', 'stripe_events', 'billing_plans']) {
      await expect(
        db.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE pactlab_app');
          await tx.$queryRawUnsafe(`SELECT * FROM ${table}`);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
