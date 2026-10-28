import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway, type ModelRequest, type SpeechToText, type TextToSpeech } from '@pactlab/ai';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { GENERIC_TRENDS, PACK_TRENDS } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

/** What the scripted model answers for each prompt (synthetic). */
function modelReply(request: ModelRequest): unknown {
  const prompt = request.messages[0]?.content ?? '';
  if (request.system.includes('Answer every question you are given')) {
    const keys = [...prompt.matchAll(/^([a-z_]+\.[a-z_]+):/gm)].map((match) => match[1] ?? '');
    return {
      trends: [
        ...keys.map((key) => ({ key, direction: key === 'macro.rates' ? 'UP' : 'FLAT', magnitude: 'MEDIUM', confidence: 'MEDIUM', narrative: `Synthetic narrative for ${key}: balanced drivers both ways.` })),
        { key: 'invented.trend', direction: 'UP', magnitude: 'HIGH', confidence: 'HIGH', narrative: 'Not asked for; must be ignored by the service.' },
      ],
    };
  }
  if (prompt.includes('What if nobody knows')) return { answer: 'Unclear.', reliesOn: ['not.a.trend'] };
  return { answer: 'If rates stay high, the projected exit value is lower: the rate rise trims the exit multiple.', reliesOn: ['macro.rates', 'rateToMultiple'] };
}

class FakeSpeech implements SpeechToText, TextToSpeech {
  readonly available = true;
  heard: Uint8Array[] = [];
  async transcribe(pcm: Uint8Array) {
    this.heard.push(pcm);
    return 'What happens to the exit value if rates stay high?';
  }
  async speak() {
    return new Uint8Array([0x49, 0x44, 0x33]); // "ID3" — an MP3 header (synthetic)
  }
}

describe('Foresight through the API (T-073)', { timeout: 30_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};
  const speech = new FakeSpeech();

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(signingKey);

  async function call(who: string, method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown, dealId?: string) {
    const response = await app.inject({ method, url: `/v1/deals/${dealId ?? a.dealId}/foresight${path}`, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    // A fintech seller, so the pack's own trends are asked too; an asking price gives today's value.
    await db.owner.query(`INSERT INTO deal_parties (id, organization_id, deal_id, role, name, ownership, company_type, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SELLER', 'Seller (synthetic)', 'PRIVATE', 'FINTECH', now())`, [a.organizationId, a.dealId]);
    await db.owner.query(
      `INSERT INTO asking_prices (id, organization_id, deal_id, version, amount, currency, basis, source, recorded_by, recorded_at) VALUES (gen_random_uuid(), $1, $2, 1, 20000000, 'USD', 'ENTERPRISE_VALUE', 'TEASER', $3, now())`,
      [a.organizationId, a.dealId, a.userId],
    );
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const gateway = new TransportClaudeGateway({ transport: new ScriptedModelTransport((request) => JSON.stringify(modelReply(request))), registry: defaultPromptRegistry() });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { gateway },
      aiStatus: { enabled: true, provider: 'synthetic', region: null, routes: [] },
      voice: { speechToText: speech, textToSpeech: speech },
      // These cases drive trend generation by hand; the automatic forecast baseline has its own suite.
      foresightAutoBaseline: false,
    });
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    for (const role of ['ANALYST', 'VIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, a, role)).subject, a);
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('starts empty, and refuses contributors and other tenants', async () => {
    expect((await call('lead', 'GET', '')).body).toMatchObject({ baseline: null, lines: [], ai: { enabled: true }, voice: { speechToText: true, textToSpeech: true } });
    expect((await call('target_contributor', 'GET', '')).status).toBe(403);
    expect((await call('other', 'GET', '')).status).toBe(404);
    expect((await call('viewer', 'POST', '/trend-sets')).status).toBe(403);
  });

  it('generates the baseline: generic plus pack trends, dated and versioned; unasked answers ignored', async () => {
    const generated = await call('analyst', 'POST', '/trend-sets');
    expect(generated.status).toBe(201);
    const view = generated.body as { baseline: Body; lines: { kind: string; trends: Body[]; projection: Body | null }[] };
    expect(view.baseline).toMatchObject({ asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), promptVersion: 'foresight.trends@1' });
    const keys = view.lines[0]?.trends.map((trend) => trend['key']);
    expect(keys).toEqual([...GENERIC_TRENDS, ...(PACK_TRENDS.FINTECH ?? [])].map((definition) => definition.key));
    expect(keys).not.toContain('invented.trend');
    expect(view.lines[0]?.trends.every((trend) => trend['provenance'] === 'AI')).toBe(true);
    const projection = view.lines[0]?.projection as { path: Body[]; impacts: Body[]; assumptions: Body };
    expect(projection.path).toHaveLength(6);
    expect(projection.assumptions).toMatchObject({ startValue: '20000000', startValueSource: expect.stringContaining('asking price') });
    expect(projection.impacts.map((impact) => impact['trendKey'])).toEqual(['macro.rates', 'macro.rates']);
    const runs = await db.owner.query(`SELECT task_type FROM ai_runs WHERE deal_id = $1`, [a.dealId]);
    expect(runs.rows).toEqual([{ task_type: 'foresight.trends' }]);
  });

  it('a user scenario overrides a trend and adds its own, recomputing without touching the baseline', async () => {
    const before = (await call('lead', 'GET', '')).body as { lines: { projection: { path: { base: string }[] } }[] };
    const baseline5 = before.lines[0]?.projection.path[5]?.base;
    const created = await call('analyst', 'POST', '/scenarios', {
      name: 'Rates stay high',
      baseGrowth: '0.12',
      baseMargin: '0.25',
      overrides: { 'macro.rates': { magnitude: 'HIGH' } },
      customTrends: [{ key: 'custom.partner_bank', label: 'Partner bank renews', direction: 'UP', magnitude: 'MEDIUM', confidence: 'LOW', narrative: 'Our own view (synthetic).', effects: [{ lever: 'GROWTH', whenUp: 1 }] }],
    });
    expect(created.status).toBe(201);
    const lines = (created.body as { lines: { kind: string; name: string; trends: Body[]; projection: { path: { base: string }[]; impacts: Body[] } }[] }).lines;
    expect(lines.map((line) => line.name)).toEqual(['AI baseline', 'Rates stay high']);
    expect(lines[0]?.projection.path[5]?.base).toBe(baseline5);
    const scenario = lines[1];
    expect(scenario?.trends.find((trend) => trend['key'] === 'macro.rates')).toMatchObject({ magnitude: 'HIGH', provenance: 'USER', adjusted: true });
    expect(scenario?.trends.find((trend) => trend['key'] === 'custom.partner_bank')).toMatchObject({ provenance: 'USER', category: 'CUSTOM' });
    expect(scenario?.projection.path[5]?.base).not.toBe(baseline5);
    expect((await db.owner.query(`SELECT magnitude FROM foresight_trends WHERE key = 'macro.rates'`)).rows).toEqual([{ magnitude: 'MEDIUM' }]);
    expect((await call('analyst', 'POST', '/scenarios', { name: 'Bad', baseGrowth: '0.1', baseMargin: '0.2', overrides: { 'no.such': { magnitude: 'HIGH' } } })).body).toMatchObject({ code: 'UNKNOWN_TREND' });
  });

  it('answers by text with the trends it relies on, refuses ungrounded answers, and audits every question', async () => {
    const answer = await call('lead', 'POST', '/questions', { question: 'What happens to the exit value if rates stay high?' });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ reliesOn: ['macro.rates', 'rateToMultiple'], audio: null });
    expect((await call('lead', 'POST', '/questions', { question: 'What if nobody knows?' })).body).toMatchObject({ code: 'UNGROUNDED_ANSWER' });
    const audits = await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'foresight.question_asked' AND deal_id = $1`, [a.dealId]);
    expect(audits.rows).toEqual([{ n: 1 }]);
  });

  it('answers a spoken question: transcript kept, audio discarded, optional spoken reply', async () => {
    const pcm = Buffer.alloc(32_000); // a second of synthetic silence, 16 kHz 16-bit
    const spoken = await call('lead', 'POST', '/voice-questions', { audio: pcm.toString('base64'), sampleRate: 16000, speak: true });
    expect(spoken.status).toBe(200);
    expect(spoken.body).toMatchObject({ question: 'What happens to the exit value if rates stay high?', audio: Buffer.from([0x49, 0x44, 0x33]).toString('base64') });
    expect(speech.heard).toHaveLength(1);
    const stored = await db.owner.query(`SELECT via, question FROM foresight_questions WHERE deal_id = $1 ORDER BY asked_at`, [a.dealId]);
    expect(stored.rows.at(-1)).toEqual({ via: 'VOICE', question: 'What happens to the exit value if rates stay high?' });
    // No column anywhere holds audio.
    const columns = await db.owner.query(`SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'foresight_%' AND (column_name LIKE '%audio%' OR data_type = 'bytea')`);
    expect(columns.rows).toEqual([]);
  });
});
