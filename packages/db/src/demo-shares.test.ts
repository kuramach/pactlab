import { newId } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoShares, NoDemoSlotFreeError } from './demo-shares';
import { authSessions } from './login';
import { OperatorRequiredError, prismaExecutor } from './ops';
import { startTestDatabase, type TestDatabase } from './testing';

const hash = (label: string) => label.padEnd(64, '0').slice(0, 64);

/** T-113: the shareable demo pool — operator-only lending, links as hashes, sessions that end with the share. */
describe('demo shares', () => {
  let db: TestDatabase;
  const operator = newId();
  const stranger = newId();
  const slots: { organizationId: string; buyer: string; seller: string }[] = [];

  beforeAll(async () => {
    db = await startTestDatabase();
    for (const [id, operatorFlag] of [[operator, true], [stranger, false]] as const) {
      await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, platform_operator) VALUES ($1, $2, 'Person (synthetic)', $3)`, [id, `pactlab|${id}`, operatorFlag]);
    }
    for (const slot of [1, 2]) {
      const organizationId = newId();
      const buyer = newId();
      const seller = newId();
      await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, created_via, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', 'DEMO', now())`, [organizationId, `Pactlab Demo ${slot} (synthetic)`, `pactlab-demo-${slot}-${organizationId.slice(-6)}`]);
      for (const user of [buyer, seller]) await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, 'Demo person (synthetic)')`, [user, `pactlab|${user}`]);
      await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_OWNER')`, [newId(), organizationId, buyer]);
      await db.owner.query(`INSERT INTO demo_slots (organization_id, slot, buyer_user_id, seller_user_id, status) VALUES ($1, $2, $3, $4, 'AVAILABLE')`, [organizationId, slot, buyer, seller]);
      slots.push({ organizationId, buyer, seller });
    }
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  const sql = () => prismaExecutor(db.prisma);

  it('only operators lend slots, one at a time, and a full pool says so', async () => {
    await expect(demoShares.slots(sql(), stranger)).rejects.toBeInstanceOf(OperatorRequiredError);
    await expect(demoShares.share(sql(), stranger, { sharedWith: 'Nope', hours: 24, buyerTokenHash: hash('x1'), sellerTokenHash: hash('x2') })).rejects.toBeInstanceOf(OperatorRequiredError);
    const first = await demoShares.share(sql(), operator, { sharedWith: 'Acme Capital (synthetic)', hours: 72, buyerTokenHash: hash('a1'), sellerTokenHash: hash('a2') });
    expect(first.slot).toBe(1);
    expect(Math.round((first.endsAt.getTime() - Date.now()) / 3_600_000)).toBe(72);
    const second = await demoShares.share(sql(), operator, { sharedWith: 'Birch Partners (synthetic)', hours: 24, buyerTokenHash: hash('b1'), sellerTokenHash: hash('b2') });
    expect(second.slot).toBe(2);
    await expect(demoShares.share(sql(), operator, { sharedWith: 'Cedar (synthetic)', hours: 24, buyerTokenHash: hash('c1'), sellerTokenHash: hash('c2') })).rejects.toBeInstanceOf(NoDemoSlotFreeError);
    const listed = await demoShares.slots(sql(), operator);
    expect(listed.map((slot) => [slot.slot, slot.status, slot.share?.sharedWith])).toEqual([
      [1, 'SHARED', 'Acme Capital (synthetic)'],
      [2, 'SHARED', 'Birch Partners (synthetic)'],
    ]);
    // Only hashes are stored.
    const stored = await db.owner.query(`SELECT buyer_token_hash FROM demo_shares WHERE id = $1`, [first.shareId]);
    expect((stored.rows[0] as { buyer_token_hash: string }).buyer_token_hash).toBe(hash('a1'));
  });

  it('a link signs in as that slot’s buyer or seller, as a demo session', async () => {
    const buyer = await demoShares.login(db.prisma, hash('a1'));
    expect(buyer).toMatchObject({ userId: slots[0]!.buyer, organizationId: slots[0]!.organizationId });
    const seller = await demoShares.login(db.prisma, hash('a2'));
    expect(seller?.userId).toBe(slots[0]!.seller);
    expect(await authSessions.check(db.prisma, { sessionId: buyer!.sessionId, subject: buyer!.subject, organizationId: buyer!.organizationId })).toMatchObject({ demo: true });
    expect(await demoShares.login(db.prisma, hash('nope'))).toBeNull();
  });

  it('ending a share ends its sessions and links, and the slot waits for a reset', async () => {
    const session = (await demoShares.login(db.prisma, hash('b1')))!;
    const share = (await demoShares.slots(sql(), operator)).find((slot) => slot.slot === 2)!.share!;
    expect(await demoShares.end(sql(), operator, share.id)).toBe(true);
    expect(await authSessions.check(db.prisma, { sessionId: session.sessionId, subject: session.subject, organizationId: session.organizationId })).toBeNull();
    expect(await demoShares.login(db.prisma, hash('b1'))).toBeNull();
    expect((await demoShares.slots(sql(), operator)).find((slot) => slot.slot === 2)).toMatchObject({ status: 'RESETTING', share: null });
    expect(await demoShares.end(sql(), operator, share.id)).toBe(false);
    // A shared slot cannot be reset from under its visitor; a free or failed one can.
    expect(await demoShares.requestReset(sql(), operator, slots[0]!.organizationId)).toBe(false);
    expect(await demoShares.requestReset(sql(), operator, slots[1]!.organizationId)).toBe(true);
  });

  it('an expired share refuses its link and ends its sessions', async () => {
    const session = (await demoShares.login(db.prisma, hash('a1')))!;
    await db.owner.query(`UPDATE demo_shares SET ends_at = now() - interval '1 minute' WHERE buyer_token_hash = $1`, [hash('a1')]);
    expect(await demoShares.login(db.prisma, hash('a1'))).toBeNull();
    expect(await authSessions.check(db.prisma, { sessionId: session.sessionId, subject: session.subject, organizationId: session.organizationId })).toBeNull();
  });
});
