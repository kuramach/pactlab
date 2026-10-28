import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

/**
 * T-097 (ADR 0015): the winning bidder does their own diligence in a linked
 * buyer-led pact in their own organization. Only the sale's winner may link,
 * and only once.
 */
describe('the winner’s linked diligence pact', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let seller: SyntheticTenant;
  let winner: SyntheticTenant;
  let other: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const bidId = newId();

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  const start = (who: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/pacts',
      headers: { authorization: `Bearer ${tokens[who] ?? ''}` },
      payload: {
        name: 'Brightwave — our diligence',
        baseCurrency: 'USD',
        initiatedBy: 'BUYER',
        buyer: { name: 'Harbor Capital (synthetic)', ownership: 'PRIVATE' },
        seller: { name: 'Brightwave Software Inc.', ownership: 'PRIVATE', companyType: 'SOFTWARE_SAAS' },
        linkedSale: { organizationId: seller.organizationId, dealId: seller.dealId },
      },
    });

  beforeAll(async () => {
    db = await startTestDatabase();
    seller = await createSyntheticTenant(db.owner, 'Seller');
    winner = await createSyntheticTenant(db.owner, 'Harbor');
    other = await createSyntheticTenant(db.owner, 'Other');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
    });
    tokens['winner'] = await token(winner.subject, winner.auth0OrganizationId);
    tokens['other'] = await token(other.subject, other.auth0OrganizationId);
    // The seller's pact runs a sale; Harbor's lead is a bidder on it (a guest there: no membership in the seller's organization).
    await db.owner.query(`UPDATE deals SET initiated_by = 'SELLER' WHERE id = $1`, [seller.dealId]);
    await db.owner.query(`INSERT INTO sale_processes (organization_id, deal_id, updated_by) VALUES ($1, $2, $3)`, [seller.organizationId, seller.dealId, seller.userId]);
    await db.owner.query(`INSERT INTO bids (id, organization_id, deal_id, firm_name, status, created_by) VALUES ($1, $2, $3, 'Harbor Capital (synthetic)', 'OFFERED', $4)`, [bidId, seller.organizationId, seller.dealId, seller.userId]);
    await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, bid_id) VALUES ($1, $2, $3, $4, 'BIDDER', $5)`, [newId(), seller.organizationId, seller.dealId, winner.userId, bidId]);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('refuses the link before the bid has won', async () => {
    expect((await start('winner')).statusCode).toBe(403);
  });

  it('starts a buyer-led pact in the winner’s own organization, linked to the sale', async () => {
    await db.owner.query(`UPDATE bids SET status = 'WON' WHERE id = $1`, [bidId]);
    const started = await start('winner');
    expect(started.statusCode).toBe(201);
    const id = (started.json() as { id: string; organizationId: string }).id;
    const row = (await db.owner.query(`SELECT organization_id, initiated_by, linked_organization_id, linked_deal_id FROM deals WHERE id = $1`, [id])) as {
      rows: { organization_id: string; initiated_by: string; linked_organization_id: string; linked_deal_id: string }[];
    };
    expect(row.rows[0]).toEqual({ organization_id: winner.organizationId, initiated_by: 'BUYER', linked_organization_id: seller.organizationId, linked_deal_id: seller.dealId });
  });

  it('links only once, and only for the winner', async () => {
    expect((await start('winner')).statusCode).toBe(409);
    expect((await start('other')).statusCode).toBe(403);
  });
});
