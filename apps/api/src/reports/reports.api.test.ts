import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { seedSynthetic } from '@pactlab/db/seed';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import { demoModelResponse, seedDemo } from '../demo-seed/seed';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { ReportsService } from './reports.service';

const SECRET = 'reports-test-secret-'.padEnd(48, 'x');
const CHARLIE = '01900000-0000-7000-8000-00000000c001';
const TROUBLED = '01900000-0000-7000-8c00-0000000d0002';
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '));
  return pages.join('\n');
}

/** T-110 acceptance: executive and pact reports, versioned and immutable, confidential per organization. */
describe('reports', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const sessions = new Map<string, string>();

  async function call(method: 'GET' | 'POST', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body, raw: response.rawPayload, headers: response.headers };
  }
  async function signIn(email: string): Promise<string> {
    const known = sessions.get(email);
    if (known) return known;
    const before = mail.sent.length;
    await call('POST', '/v1/auth/email/start', { email });
    for (let i = 0; i < 50 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1];
    const token = (await call('POST', '/v1/auth/email/verify', { email, code })).body['token'] as string;
    sessions.set(email, token);
    return token;
  }
  async function generate(token: string, payload: Body) {
    const started = await call('POST', '/v1/reports', payload, token);
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    await app.get(ReportsService, { strict: false }).whenIdle();
    return started.body as { id: string; version: number };
  }
  const download = async (token: string, id: string) => {
    const response = await call('GET', `/v1/reports/${id}/pdf`, undefined, token);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    return response.raw;
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    await seedSynthetic(db.owner, db.prisma);
    const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
    const store = new InMemoryObjectStore();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new DisabledIdentityVerifier(),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      foresightAutoBaseline: false,
      uploads: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
      documents: { objectStore: store, malwareScanner: new SignatureMalwareScanner(), gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }) },
    });
    await seedDemo(app, db.prisma);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('the executive report lists every pact the organization can see, with a roll-up made from them', async () => {
    const token = await signIn('lead@charlie.example');
    const report = await generate(token, { scope: 'EXECUTIVE' });
    const history = (await call('GET', '/v1/reports?scope=EXECUTIVE', undefined, token)).body['items'] as { id: string; status: string; captured: { pactCount: number } }[];
    const entry = history.find((item) => item.id === report.id)!;
    expect(entry.status).toBe('READY');
    const deals = (await call('GET', '/v1/deals', undefined, token)).body['items'] as { name: string }[];
    expect(entry.captured.pactCount).toBe(deals.length);
    const text = await pdfText(await download(token, report.id));
    expect(text).toContain('Executive report');
    expect(text).toContain('Every total above is the sum of the pacts listed below.');
    for (const deal of deals) expect(text.replace(/\s+/g, ' ')).toContain(deal.name.slice(0, 20));
    expect(text).toMatch(/Page 1 of \d+/);
    expect(text).toContain('v1');
  });

  it('a pact report reproduces findings, the bridge and the persona; a new version never changes the old one', async () => {
    const token = await signIn('lead@charlie.example');
    const v1 = await generate(token, { scope: 'PACT', dealId: TROUBLED });
    const firstBytes = await download(token, v1.id);
    const text = await pdfText(firstBytes);
    const findings = (await call('GET', `/v1/deals/${TROUBLED}/findings`, undefined, token)).body['items'] as { title: string }[];
    for (const finding of findings.slice(0, 3)) expect(text.replace(/\s+/g, ' ')).toContain(finding.title.slice(0, 30));
    expect(text).toContain('Purchase-price bridge');
    expect(text).toContain('Priced as');

    // The deal moves: a new finding. v2 shows it; v1's stored bytes are exactly as before.
    const created = await call('POST', `/v1/deals/${TROUBLED}/findings`, { domain: 'FINANCIAL', title: 'Late-added synthetic finding for v2', description: 'Synthetic.', severity: 'LOW', confidence: 'HIGH' }, token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const v2 = await generate(token, { scope: 'PACT', dealId: TROUBLED });
    expect(v2.version).toBe(v1.version + 1);
    expect(Buffer.compare(await download(token, v1.id), firstBytes)).toBe(0);
    expect(await pdfText(await download(token, v2.id))).toContain('Late-added synthetic finding for v2');
    expect(await pdfText(firstBytes)).not.toContain('Late-added synthetic finding for v2');
    const history = (await call('GET', `/v1/reports?dealId=${TROUBLED}`, undefined, token)).body['items'] as { version: number }[];
    expect(history.map((item) => item.version).slice(0, 2)).toEqual([v2.version, v1.version]);
    const audit = await db.owner.query(`SELECT action, count(*)::int AS n FROM audit_events WHERE action LIKE 'report.%' AND organization_id = $1 GROUP BY action ORDER BY action`, [CHARLIE]);
    expect((audit.rows as { action: string }[]).map((row) => row.action)).toEqual(['report.downloaded', 'report.generated']);
  });

  it('a seller-side contributor gets their view only: no persona, no buyer pricing, no confirmed value', async () => {
    const userId = newId();
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Seller contributor (synthetic)', 'seller@troubled-target.example')`, [userId, `pactlab|${userId}`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), CHARLIE, userId]);
    await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'TARGET_CONTRIBUTOR')`, [newId(), CHARLIE, TROUBLED, userId]);
    const token = await signIn('seller@troubled-target.example');
    const report = await generate(token, { scope: 'PACT', dealId: TROUBLED });
    const text = await pdfText(await download(token, report.id));
    expect(text).toContain('Pact report');
    for (const secret of ['Priced as', 'Purchase-price bridge', 'Value confirmed, not paid for', 'Equity purchase price']) expect(text, secret).not.toContain(secret);
  });

  it('another organization can generate, list or download nothing of these', async () => {
    const orgId = newId();
    const userId = newId();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, 'Elsewhere (synthetic)', $2, 'EMAIL_CODE', now())`, [orgId, `elsewhere-${orgId.slice(-8)}`]);
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Elsewhere lead', 'lead@elsewhere-reports.example')`, [userId, `pactlab|${userId}`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_OWNER')`, [newId(), orgId, userId]);
    const token = await signIn('lead@elsewhere-reports.example');
    expect((await call('POST', '/v1/reports', { scope: 'PACT', dealId: TROUBLED }, token)).status).toBe(404);
    expect((await call('GET', '/v1/reports', undefined, token)).body['items']).toEqual([]);
    const theirs = (await db.owner.query(`SELECT id FROM report_versions WHERE organization_id = $1 AND status = 'READY' LIMIT 1`, [CHARLIE])).rows[0] as { id: string };
    expect((await call('GET', `/v1/reports/${theirs.id}/pdf`, undefined, token)).status).toBe(404);
    // Their own executive report has none of Charlie's pacts.
    const own = await generate(token, { scope: 'EXECUTIVE' });
    expect(await pdfText(await download(token, own.id))).toContain('No pacts yet.');
  });
});
