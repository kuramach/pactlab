import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway, type ModelRequest } from '@pactlab/ai';
import { GitHubFixtureAdapter } from '@pactlab/connectors';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, unknown>;
type Method = 'GET' | 'POST' | 'PUT';

interface Money {
  amount: string;
  currency: string;
}
interface Evaluation {
  id: string;
  persona: string;
  runIds: string[];
  cases: { case: string; equityPurchasePrice: string }[];
  termMix: { price: Money; cashAtClose: Money; earnout: Money; sellerFinancing: Money; lines: { lever: string; amount: Money; findingId: string | null }[] };
  deltaToActive: { price: string } | null;
}
interface PricingView {
  persona: { pact: string | null; organizationDefault: string | null; effective: string };
  active: { evaluationId: string } | null;
  evaluations: Evaluation[];
  batches: { id: string; version: number; evaluationId: string; proposedAt: string | null; terms: { ordinal: number; lever: string; amount: string }[] }[];
  sellerSeesOtherPricing: boolean;
  brief: { sections: { heading: string; body: string; citedFindingIds: string[] }[] } | null;
}

/** Answers the brief prompt with one grounded section per finding, plus one that states a figure. */
const briefRequests: ModelRequest[] = [];
function briefResponder(request: ModelRequest): string {
  briefRequests.push(request);
  const ids = [...(request.messages[0]?.content ?? '').matchAll(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) \|/g)].map((match) => match[1]!);
  return JSON.stringify({
    sections: [
      ...ids.map((id) => ({ heading: 'What diligence found', body: 'The evidence behind this finding belongs in the terms rather than in a discussion of the headline number.', citedFindingIds: [id] })),
      { heading: 'Holdback', body: 'Ask for a 15% holdback on the purchase price against the open findings.', citedFindingIds: [ids[0]!] },
    ],
  });
}

describe('buyer personas API (T-105)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  let evidenceId: string;
  let headSha: string;
  const found: Record<'arr' | 'keyPerson' | 'remediation' | 'escrow', string> = { arr: '', keyPerson: '', remediation: '', escrow: '' };

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: Method, url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : {}) as Body, text: response.body };
  }
  const deal = (path: string, dealId = () => a.dealId) => `/v1/deals/${dealId()}${path}`;
  const pricing = (who: string, method: Method, path = '', payload?: Body) => call(who, method, deal(`/pricing${path}`), payload);
  const viewOf = (response: { body: Body }) => response.body as unknown as PricingView;

  async function acceptedFinding(domain: string, title: string, pricedRisk: Body) {
    const findings = (who: string, path: string, payload: Body) => call(who, 'POST', deal(`/findings${path}`), payload);
    const created = await findings('analyst', '', {
      domain,
      title,
      description: `${title} (synthetic).`,
      severity: 'HIGH',
      confidence: 'HIGH',
      evidence: [{ evidenceItemId: evidenceId, commitSha: headSha, toolName: 'cyclonedx', toolVersion: '1.0.0-fixture', rulesetVersion: null, path: null, lineStart: null, lineEnd: null }],
      pricedRisk,
      direction: -1,
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body['id'] as string;
    await findings('analyst', `/${id}/reviews`, { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Ready' });
    expect((await findings('reviewer', `/${id}/reviews`, { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Confirmed' })).status).toBe(201);
    return id;
  }

  const risk = (type: string, low: string, high: string) => ({ type, currency: 'USD', low, high, basis: 'Synthetic estimate' });

  async function scenario(name: string, scenarioCase: string | null, multiple: string) {
    const created = await call('lead', 'POST', deal('/valuation/scenarios'), {
      name,
      scenarioCase,
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple },
        bridge: { cash: '2000000', debt: '5000000', debtLikeItems: '500000', workingCapitalAdjustment: '-250000' },
        findingLinks: Object.values(found).map((findingId) => ({ findingId, point: 'MID' })),
      },
    });
    expect(created.status, created.text).toBe(201);
    return (created.body['scenario'] as { id: string }).id;
  }

  const acceptedFindings = async () =>
    ((await call('lead', 'GET', deal('/findings?status=ACCEPTED'))).body['items'] as { id: string; version: number; pricedRisk: unknown; direction: number }[])
      .map(({ id, version, pricedRisk, direction }) => ({ id, version, pricedRisk, direction }))
      .sort((x, y) => (x.id < y.id ? -1 : 1));

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Persona');
    b = await createSyntheticTenant(db.owner, 'Outsider');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: {
        objectStore: new InMemoryObjectStore(),
        malwareScanner: new SignatureMalwareScanner(),
        gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(briefResponder), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }),
      },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
    for (const role of ['ANALYST', 'REVIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, a, role)).subject, a.auth0OrganizationId);
    }
    const connection = await call('lead', 'POST', deal('/connections'), { provider: 'csv', displayName: 'TroubledCo export', mode: 'FIXTURE', config: { datasets: ['TroubledCo/customers.csv'] } });
    await app.inject({ method: 'POST', url: deal('/sync-runs'), headers: { authorization: `Bearer ${tokens['lead']!}`, 'idempotency-key': `sync-${newId()}` }, payload: { connectionId: connection.body['id'] } });
    evidenceId = ((await call('lead', 'GET', deal('/evidence'))).body['items'] as { id: string }[])[0]!.id;
    headSha = (await new GitHubFixtureAdapter({ repository: 'troubledco/core' }).head({ organizationId: a.organizationId, dealId: a.dealId, connectionId: newId(), credentialRef: null })).headSha;

    // EV 65m at 6.5×; the ARR gap clears every bar, the remediation only Value's and Grave's.
    found.arr = await acceptedFinding('OSS_LICENSE', 'Recurring revenue overstated against billing', risk('PRICE_REDUCTION', '2000000', '4000000'));
    found.keyPerson = await acceptedFinding('KEY_PERSON', 'Jordan Example holds most of the core module', risk('PRICE_REDUCTION', '1500000', '2500000'));
    found.remediation = await acceptedFinding('OSS_LICENSE', 'Copyleft component to replace', risk('REMEDIATION_COST', '650000', '1300000'));
    found.escrow = await acceptedFinding('SECURITY', 'Unpatched dependency exposure', risk('ESCROW', '1000000', '2000000'));
    await scenario('Downside — 5.5×', 'DOWNSIDE', '5.5');
    await scenario('Base — 6.5×', 'BASE', '6.5');
    await scenario('Upside — 7.5×', 'UPSIDE', '7.5');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('prices the same findings under all three personas, Compounder >= Value >= Grave, findings untouched', async () => {
    const before = await acceptedFindings();
    const initial = viewOf(await pricing('lead', 'GET'));
    expect(initial.persona).toMatchObject({ pact: null, organizationDefault: null, effective: 'VALUE_INVESTOR' });
    expect(initial.active).toBeNull();

    for (const persona of ['QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER']) {
      const response = await pricing('analyst', 'POST', '/evaluations', { persona });
      expect(response.status, response.text).toBe(201);
    }
    const view = viewOf(await pricing('lead', 'GET'));
    const latest = (persona: string) => view.evaluations.find((evaluation) => evaluation.persona === persona)!;
    const price = (persona: string) => Number(latest(persona).termMix.price.amount);
    expect(price('QUALITY_COMPOUNDER')).toBeGreaterThanOrEqual(price('VALUE_INVESTOR'));
    expect(price('VALUE_INVESTOR')).toBeGreaterThanOrEqual(price('GRAVE_DANCER'));
    expect(price('QUALITY_COMPOUNDER')).toBeGreaterThan(price('GRAVE_DANCER'));
    // Every evaluation priced all three tagged cases; none pays above Base.
    for (const evaluation of view.evaluations) {
      expect(evaluation.cases.map((entry) => entry.case).sort()).toEqual(['BASE', 'DOWNSIDE', 'UPSIDE']);
      const base = Number(evaluation.cases.find((entry) => entry.case === 'BASE')!.equityPurchasePrice);
      expect(Number(evaluation.termMix.price.amount)).toBeLessThanOrEqual(base);
    }
    // Term mixes lean the way each persona does.
    const levers = (persona: string) => latest(persona).termMix.lines.map((line) => line.lever);
    expect(levers('QUALITY_COMPOUNDER')).toEqual(expect.arrayContaining(['RETENTION', 'INDEMNITY']));
    expect(levers('QUALITY_COMPOUNDER')).not.toContain('EARNOUT');
    expect(levers('GRAVE_DANCER')[0]).toBe('ESCROW');
    expect(levers('GRAVE_DANCER')).toEqual(expect.arrayContaining(['EARNOUT', 'SELLER_FINANCING']));
    // Same evidence, same findings: identical before and after all three.
    expect(await acceptedFindings()).toEqual(before);
    // The first evaluation became the active pricing; the others carry deltas against it.
    expect(view.active?.evaluationId).toBe(latest('QUALITY_COMPOUNDER').id);
    expect(latest('GRAVE_DANCER').deltaToActive?.price.startsWith('-')).toBe(true);
  });

  it('switching persona adds runs and never touches earlier ones or the scenarios', async () => {
    const view = viewOf(await pricing('lead', 'GET'));
    const first = view.evaluations.at(-1)!;
    const { rows: before } = await db.owner.query<{ id: string; result: unknown; persona: string }>('SELECT id, result, persona FROM valuation_runs WHERE id = ANY($1) ORDER BY id', [first.runIds]);
    expect(before.every((row) => row.persona === first.persona)).toBe(true);

    expect((await pricing('lead', 'POST', '/evaluations', { persona: 'GRAVE_DANCER' })).status).toBe(201);
    const { rows: after } = await db.owner.query<{ id: string; result: unknown }>('SELECT id, result FROM valuation_runs WHERE id = ANY($1) ORDER BY id', [first.runIds]);
    expect(after).toEqual(before.map(({ id, result }) => ({ id, result })));

    // Persona runs never become a scenario's latest run, so they cannot be submitted.
    const scenarios = (await call('lead', 'GET', deal('/valuation/scenarios'))).body['items'] as { latestRun: unknown }[];
    expect(scenarios.every((item) => item.latestRun === null)).toBe(true);
  });

  it('keeps proposed terms sticky until the buyer proposes again', async () => {
    const view = viewOf(await pricing('lead', 'GET'));
    const grave = view.evaluations.find((evaluation) => evaluation.persona === 'GRAVE_DANCER')!;
    expect((await pricing('lead', 'POST', `/evaluations/${grave.id}/adopt`)).status).toBe(201);
    const drafted = viewOf(await pricing('lead', 'POST', '/terms'));
    const v1 = drafted.batches[0]!;
    expect(v1).toMatchObject({ version: 1, evaluationId: grave.id, proposedAt: null });
    // Nothing reaches the seller before it is proposed.
    expect((await call('target_contributor', 'GET', deal('/terms/proposed'))).body).toEqual({ proposed: null });

    expect((await pricing('lead', 'PUT', `/terms/${v1.id}/notes`, { notes: [{ ordinal: 0, sellerNote: 'Held for 18 months against the open findings.' }] })).status).toBe(200);
    expect((await pricing('lead', 'POST', `/terms/${v1.id}/propose`)).status).toBe(201);
    const seen = (await call('target_contributor', 'GET', deal('/terms/proposed'))).body['proposed'] as { version: number; terms: { lever: string; amount: string; sellerNote: string }[] };
    expect(seen.version).toBe(1);
    expect(seen.terms[0]).toMatchObject({ lever: 'ESCROW', sellerNote: 'Held for 18 months against the open findings.' });
    // Proposed terms are frozen.
    expect((await pricing('lead', 'POST', `/terms/${v1.id}/propose`)).status).toBe(409);
    expect((await pricing('lead', 'PUT', `/terms/${v1.id}/notes`, { notes: [{ ordinal: 0, sellerNote: 'changed' }] })).status).toBe(409);

    // Re-pricing internally changes nothing seller-side.
    const compounder = view.evaluations.find((evaluation) => evaluation.persona === 'QUALITY_COMPOUNDER')!;
    const adopted = viewOf(await pricing('lead', 'POST', `/evaluations/${compounder.id}/adopt`));
    expect(adopted.sellerSeesOtherPricing).toBe(true);
    expect((await call('target_contributor', 'GET', deal('/terms/proposed'))).body['proposed']).toEqual(seen);

    // Proposing again from the adopted evaluation is a new version.
    const v2 = viewOf(await pricing('lead', 'POST', '/terms')).batches[0]!;
    expect(v2.version).toBe(2);
    await pricing('lead', 'POST', `/terms/${v2.id}/propose`);
    const now = (await call('target_contributor', 'GET', deal('/terms/proposed'))).body['proposed'] as { version: number };
    expect(now.version).toBe(2);
    expect(viewOf(await pricing('lead', 'GET')).sellerSeesOtherPricing).toBe(false);
  });

  it('shows the seller no persona, parameter, finding or evaluation', async () => {
    const response = await call('target_contributor', 'GET', deal('/terms/proposed'));
    const proposed = response.body['proposed'] as Body;
    expect(Object.keys(proposed).sort()).toEqual(['currency', 'proposedAt', 'terms', 'version']);
    for (const term of proposed['terms'] as Body[]) expect(Object.keys(term).sort()).toEqual(['amount', 'currency', 'lever', 'sellerNote']);
    const text = response.text.toLowerCase();
    for (const leak of ['persona', 'compounder', 'value investor', 'value_investor', 'grave', 'personas-1', 'materiality', 'weight', 'evaluation', ...Object.values(found)]) {
      expect(text, leak).not.toContain(leak.toLowerCase());
    }
  });

  it('keeps pricing buyer-side and inside the tenant', async () => {
    expect((await pricing('target_contributor', 'GET')).status).toBe(403);
    expect((await pricing('target_contributor', 'POST', '/evaluations', { persona: 'GRAVE_DANCER' })).status).toBe(403);
    expect((await pricing('target_contributor', 'POST', '/terms')).status).toBe(403);
    expect((await call('other', 'GET', deal('/pricing'))).status).toBe(404);
    expect((await call('other', 'GET', deal('/terms/proposed'))).status).toBe(404);
    const audit = await db.owner.query<{ action: string }>(`SELECT DISTINCT action FROM audit_events WHERE deal_id = $1 AND outcome = 'SUCCEEDED'`, [a.dealId]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['pricing.evaluated', 'pricing.adopted', 'terms.drafted', 'terms.proposed']));
  });

  it('drafts a brief in the persona’s tone, citing only accepted findings, never people or figures', async () => {
    const view = viewOf(await pricing('lead', 'GET'));
    const response = await pricing('lead', 'POST', `/evaluations/${view.active!.evaluationId}/brief`);
    expect(response.status, response.text).toBe(201);
    const brief = viewOf(response).brief!;
    expect(brief.sections.length).toBeGreaterThan(0);
    expect(brief.sections.every((section) => !/\d/.test(section.body))).toBe(true);
    const sent = briefRequests.at(-1)!;
    const prompt = sent.messages[0]!.content;
    expect(prompt).toContain('<tone>QUALITY_AND_RISK</tone>');
    expect(prompt).not.toContain('Jordan Example');
    expect(prompt).toContain('People risk (details withheld)');
    // Levers only: no amounts reach the model.
    for (const amount of ['4000000', '2500000', '1300000', '2000000']) expect(prompt).not.toContain(amount);
    expect((await pricing('target_contributor', 'POST', `/evaluations/${view.active!.evaluationId}/brief`)).status).toBe(403);
  });

  it('sets the organization default and the pact persona', async () => {
    expect((await call('analyst', 'PUT', '/v1/organization/persona', { persona: 'GRAVE_DANCER' })).status).toBe(403);
    const set = await call('lead', 'PUT', '/v1/organization/persona', { persona: 'QUALITY_COMPOUNDER' });
    expect(set.body).toMatchObject({ defaultPersona: 'QUALITY_COMPOUNDER', effective: 'QUALITY_COMPOUNDER', canEdit: true });
    expect(viewOf(await pricing('lead', 'GET')).persona).toMatchObject({ pact: null, organizationDefault: 'QUALITY_COMPOUNDER', effective: 'QUALITY_COMPOUNDER' });
    expect(viewOf(await pricing('lead', 'PUT', '/persona', { persona: 'GRAVE_DANCER' })).persona.effective).toBe('GRAVE_DANCER');
    expect((await pricing('target_contributor', 'PUT', '/persona', { persona: 'VALUE_INVESTOR' })).status).toBe(403);
    // The pact's persona never appears on the deal itself, which the seller's side can read.
    const dealView = await call('target_contributor', 'GET', deal(''));
    expect(dealView.text.toLowerCase()).not.toContain('grave');
  });
});
