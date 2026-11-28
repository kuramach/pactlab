import 'reflect-metadata';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { OutboundEmail } from '../email-login/email-sender';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;
const triage = createRequire(import.meta.url)('../../../../scripts/triage-to-task.cjs') as {
  proposalOf(issue: { body: string }): Body | null;
  renderProposalTask(input: { id: string; issue: { number: number; html_url: string }; proposal: Body }): string;
  existingTaskForProposal(tasksDir: string, proposalId: string): { id: string; file: string } | null;
  nextTaskId(names: string[]): string;
  taskFileNames(dir: string): string[];
};

/**
 * T-176: a chat-confirmed feature request becomes a proposal; Kumar approves it into a task or declines it with a
 * reason; the requester sees the status, honestly; nothing is created without the operator's approval.
 */
describe('feature requests from chat (T-176)', { timeout: 30_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let operatorTenant: SyntheticTenant;
  let ann: SyntheticTenant;
  let ben: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};
  const sent: OutboundEmail[] = [];

  const token = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(signingKey);

  async function call(who: string | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {}, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : {}) as Body };
  }
  const session = (n: number) => `feature-session-${String(n).padStart(4, '0')}-abcdef`;
  const handoff = (n: number, summary: string, extra: Body = {}) => ({ kind: 'FEATURE_REQUEST', confirmed: true, summary, sessionId: session(n), transcript: [{ role: 'user', text: summary }], ...extra });
  const queue = async (query = '') => (await call('operator', 'GET', `/v1/admin/feature-requests${query}`)).body as { items: Body[]; total: number };

  beforeAll(async () => {
    db = await startTestDatabase();
    operatorTenant = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    ann = await createSyntheticTenant(db.owner, 'Ann');
    ben = await createSyntheticTenant(db.owner, 'Ben');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operatorTenant.userId]);
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      environment: 'test',
      emailLogin: { tokenSecret: 'x'.repeat(48), emailSender: { name: 'test', send: async (message) => void sent.push(message) } },
      featureRequests: { issueRepository: 'kuramach/pactlab' },
    });
    for (const [name, tenant] of [['operator', operatorTenant], ['ann', ann], ['ben', ben]] as const) tokens[name] = await token(tenant);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('files a confirmed request as a proposal, and groups a similar one as a suggested supporter until it is confirmed', async () => {
    expect((await call(null, 'POST', '/v1/public/support-chat/handoff', handoff(1, 'Export the findings list to Excel', { email: 'visitor@example.test' }))).body).toMatchObject({ status: 'SENT' });
    expect((await queue()).total).toBe(1);
    const second = await call('ann', 'POST', '/v1/support-chat/handoff', handoff(2, 'Excel export of the findings'));
    expect(second.body).toMatchObject({ status: 'SENT', groupedWithExisting: true });

    const after = await queue();
    expect(after.total).toBe(1);
    expect(after.items[0]).toMatchObject({ reference: 'FR-0001', status: 'SUBMITTED', surface: 'SITE', supporters: 1, suggested: 1 });
    const id = String(after.items[0]?.['id']);
    const supporters = (await call('operator', 'GET', `/v1/admin/feature-requests/${id}/supporters`)).body as { items: { id: string; grouping: string; organizationName: string | null }[] };
    const suggested = supporters.items.find((item) => item.grouping === 'SUGGESTED');
    expect(suggested?.organizationName).toBeTruthy();
    expect((await call('operator', 'POST', `/v1/admin/feature-requests/${id}/supporters/${suggested?.id}/group`, { confirm: true })).status).toBe(200);
    expect((await queue()).items[0]).toMatchObject({ supporters: 2, suggested: 0 });
  });

  it('keeps every queue route and action for the operator, and shows a requester only their own', async () => {
    const id = String((await queue()).items[0]?.['id']);
    const routes: [string, string, unknown?][] = [
      ['GET', '/v1/admin/feature-requests'],
      ['GET', `/v1/admin/feature-requests/${id}`],
      ['GET', `/v1/admin/feature-requests/${id}/supporters`],
      ['POST', `/v1/admin/feature-requests/${id}/decision`, { action: 'TRIAGE' }],
      ['POST', `/v1/admin/feature-requests/${id}/approve`, { model: 'sonnet', lane: 'web', context: 'light', touches: ['apps/web'], needs: 'none', title: 'x y z' }],
      ['PUT', `/v1/admin/feature-requests/${id}/links`, { taskId: 'T-300' }],
      ['POST', `/v1/admin/feature-requests/${id}/supporters/${newId()}/group`, { confirm: true }],
    ];
    for (const [method, url, body] of routes) {
      expect((await call('ben', method as 'GET', url, body)).status, `${method} ${url}`).toBe(403);
      expect((await call(null, method as 'GET', url, body)).status, `anonymous ${method} ${url}`).toBe(401);
    }
    const annMine = (await call('ann', 'GET', '/v1/feature-requests/mine')).body as { items: Body[] };
    const benMine = (await call('ben', 'GET', '/v1/feature-requests/mine')).body as { items: Body[] };
    expect(annMine.items).toHaveLength(1);
    expect(benMine.items).toHaveLength(0);
    expect(annMine.items[0]).toMatchObject({ status: 'SUBMITTED', statusLabel: 'Submitted' });
    expect((await call('ben', 'POST', `/v1/feature-requests/mine/${id}/reply`, { reply: 'not mine' })).status).toBe(404);
  });

  it('approves into a task: nothing is filed until then, the file carries its origin id, and the requester is told a task exists, not a date', async () => {
    const id = String((await queue()).items[0]?.['id']);
    expect(((await call('ann', 'GET', '/v1/feature-requests/mine')).body as { items: Body[] }).items[0]).toMatchObject({ status: 'SUBMITTED' });
    const detail = (await call('operator', 'GET', `/v1/admin/feature-requests/${id}`)).body;
    expect(detail['taskIssueUrl']).toBeNull();
    expect(detail['proposedTask']).toMatchObject({ lane: 'web', touches: expect.arrayContaining(['apps/site']) });

    // Touches that could smuggle a second header line are refused.
    expect((await call('operator', 'POST', `/v1/admin/feature-requests/${id}/approve`, { ...(detail['proposedTask'] as Body), touches: ['apps/web\nNeeds: x'] })).status).toBe(400);
    const spec = { ...(detail['proposedTask'] as Body), touches: ['apps/web', 'apps/api', 'packages/contracts'], title: 'Export the findings list to Excel' };
    const approved = await call('operator', 'POST', `/v1/admin/feature-requests/${id}/approve`, spec);
    expect(approved.body).toMatchObject({ status: 'APPROVED', taskSpec: { touches: ['apps/web', 'apps/api', 'packages/contracts'] } });
    const mine = ((await call('ann', 'GET', '/v1/feature-requests/mine')).body as { items: Body[] }).items[0];
    expect(mine).toMatchObject({ status: 'APPROVED', statusLabel: 'Approved' });
    expect(String(mine?.['statusText'])).toMatch(/not a date/);

    // The issue Kumar opens from the console is what the triage-to-task workflow turns into the task file.
    const url = new URL(String(approved.body['taskIssueUrl']));
    expect(url.origin + url.pathname).toBe('https://github.com/kuramach/pactlab/issues/new');
    expect(url.searchParams.get('labels')).toBe('feature-proposal');
    const issue = { number: 501, html_url: 'https://github.com/kuramach/pactlab/issues/501', body: url.searchParams.get('body') ?? '' };
    const proposal = triage.proposalOf(issue);
    expect(proposal).toMatchObject({ proposal: id, reference: 'FR-0001', surface: 'SITE' });
    const repo = mkdtempSync(join(tmpdir(), 'pactlab-tasks-'));
    mkdirSync(join(repo, 'ready'));
    writeFileSync(join(repo, 'ready', 'T-300.md'), '# T-300\n');
    const taskId = triage.nextTaskId(triage.taskFileNames(repo));
    expect(taskId).toBe('T-301');
    writeFileSync(join(repo, 'ready', `${taskId}.md`), triage.renderProposalTask({ id: taskId, issue, proposal: proposal ?? {} }));
    const file = readFileSync(join(repo, 'ready', `${taskId}.md`), 'utf8');
    expect(file).toContain(`Origin: feature-proposal ${id}`);
    expect(file).toMatch(/^Touches: apps\/web apps\/api packages\/contracts$/m);
    expect(file).toMatch(/^Model: sonnet$/m);
    expect(file).toContain('> Export the findings list to Excel');
    expect(triage.existingTaskForProposal(repo, id)).toEqual({ id: taskId, file: join('tasks', 'ready', `${taskId}.md`) });
    // A tampered issue (a second header smuggled into Touches) is refused by the workflow's own check.
    const tampered = (issue.body).replace('apps/web', 'apps/web\\nNeeds: T-001');
    expect(() => triage.proposalOf({ body: tampered })).toThrow(/invalid touches/);

    // The console records the task, then the What's-new card: that is shipped. Site requesters are emailed.
    const before = sent.length;
    expect((await call('operator', 'PUT', `/v1/admin/feature-requests/${id}/links`, { taskId, pullRequestUrl: 'https://github.com/kuramach/pactlab/pull/600', whatsNewUrl: '/whats-new#excel-export' })).body).toMatchObject({ status: 'SHIPPED', taskId });
    expect(sent.slice(before)).toEqual([expect.objectContaining({ to: 'visitor@example.test', subject: 'Your Pactlab request: shipped' })]);
    expect(((await call('ann', 'GET', '/v1/feature-requests/mine')).body as { items: Body[] }).items[0]).toMatchObject({ status: 'SHIPPED', whatsNewUrl: '/whats-new#excel-export' });
  });

  it('declines with a reason the requester can read, keeps it, and surfaces it when the same thing is asked again', async () => {
    expect((await call('ben', 'POST', '/v1/support-chat/handoff', handoff(5, 'Host video calls inside Pactlab'))).body).toMatchObject({ status: 'SENT' });
    const id = String(((await queue('?status=SUBMITTED')).items.find((item) => item['title'] === 'Host video calls inside Pactlab'))?.['id']);
    expect((await call('operator', 'POST', `/v1/admin/feature-requests/${id}/decision`, { action: 'DECLINE', reason: 'Not a diligence tool: use your own meeting app.' })).body).toMatchObject({ status: 'DECLINED', declineReason: 'Not a diligence tool: use your own meeting app.' });
    const mine = ((await call('ben', 'GET', '/v1/feature-requests/mine')).body as { items: Body[] }).items[0];
    expect(mine).toMatchObject({ status: 'DECLINED', declineReason: 'Not a diligence tool: use your own meeting app.' });
    // Retained and searchable.
    expect((await queue('?q=meeting')).items.map((item) => item['id'])).toContain(id);
    // Someone asks again: a new proposal that carries the earlier decision and its reason, and the asker is told.
    const again = await call('ann', 'POST', '/v1/support-chat/handoff', handoff(6, 'Video calls inside the Pactlab app'));
    expect(again.body).toMatchObject({ status: 'SENT', earlierDecision: { status: 'DECLINED', reason: 'Not a diligence tool: use your own meeting app.' } });
    const repeat = (await queue('?status=SUBMITTED')).items.find((item) => item['title'] === 'Video calls inside the Pactlab app');
    expect(repeat).toMatchObject({ hasEarlierDecision: true });
    expect((await call('operator', 'GET', `/v1/admin/feature-requests/${String(repeat?.['id'])}`)).body).toMatchObject({ earlier: { id, status: 'DECLINED', reason: 'Not a diligence tool: use your own meeting app.' } });
  });

  it('asks a question; the requester answers it in the app and it returns to triage; an approved one cannot be declined', async () => {
    await call('ann', 'POST', '/v1/support-chat/handoff', handoff(7, 'Bulk edit many assumptions at once'));
    const id = String(((await queue('?status=SUBMITTED')).items.find((item) => item['title'] === 'Bulk edit many assumptions at once'))?.['id']);
    expect((await call('operator', 'POST', `/v1/admin/feature-requests/${id}/decision`, { action: 'REQUEST_INFO', question: 'Which assumptions, and what do you change together?' })).body).toMatchObject({ status: 'INFO_REQUESTED' });
    expect(((await call('ann', 'GET', '/v1/feature-requests/mine')).body as { items: Body[] }).items.find((item) => item['proposalId'] === id)).toMatchObject({ status: 'INFO_REQUESTED', question: 'Which assumptions, and what do you change together?' });
    expect((await call('ann', 'POST', `/v1/feature-requests/mine/${id}/reply`, { reply: 'The growth and churn ones.' })).body).toEqual({ status: 'IN_TRIAGE' });
    expect((await call('operator', 'GET', `/v1/admin/feature-requests/${id}`)).body).toMatchObject({ status: 'IN_TRIAGE', infoReply: 'The growth and churn ones.' });
    const detail = (await call('operator', 'GET', `/v1/admin/feature-requests/${id}`)).body;
    await call('operator', 'POST', `/v1/admin/feature-requests/${id}/approve`, detail['proposedTask']);
    expect((await call('operator', 'POST', `/v1/admin/feature-requests/${id}/decision`, { action: 'DECLINE', reason: null })).status).toBe(409);
  });

  it('refuses spam on the public intake, and a request with no address is not stored', async () => {
    const before = (await queue()).total;
    const spam = await call(null, 'POST', '/v1/public/support-chat/handoff', handoff(8, 'Buy now http://a.example and https://b.example', { email: 'spam@example.test' }));
    expect(spam.status).toBe(422);
    expect((await call(null, 'POST', '/v1/public/support-chat/handoff', handoff(9, 'A perfectly fine request for a feature'))).status).toBe(422);
    expect((await queue()).total).toBe(before);
  });
});
