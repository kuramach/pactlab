import 'reflect-metadata';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, SUPPORT_MESSAGES, TransportClaudeGateway, type ModelRequest } from '@pactlab/ai';
import type { FeatureRequestIntakeItem, SupportChatReplyView } from '@pactlab/contracts';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const DEAL = '0193a4c2-7a1e-7b3c-9d2e-4f5a6b7c8d9e';
const TEAM = 'help@pactlab.test';

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** A stand-in model that answers only from the sources it was sent: the first one, as steps when it has them. */
function sourceBlocks(request: ModelRequest) {
  return [...(request.messages[0]?.content ?? '').matchAll(/<untrusted_source citation_id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/untrusted_source>/g)].map((m) => ({ id: m[1]!, text: m[2]! }));
}
const model = new ScriptedModelTransport((request) => {
  const question = /Question: (.*)$/m.exec(request.messages[0]?.content ?? '')?.[1] ?? '';
  if (/slack/i.test(question)) return JSON.stringify({ kind: 'FEATURE_REQUEST', answer: 'Not available.', steps: [], sources: [], featureSummary: 'a Slack integration' });
  if (/Befund/i.test(question)) return JSON.stringify({ kind: 'NEEDS_ACCOUNT', answer: 'Needs the deal.', steps: [], sources: [], featureSummary: null });
  const block = sourceBlocks(request)[0];
  if (!block) return JSON.stringify({ kind: 'DONT_KNOW', answer: 'No.', steps: [], sources: [], featureSummary: null });
  const steps = [...block.text.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
  return JSON.stringify({ kind: steps.length ? 'STEPS' : 'ANSWER', answer: block.text.split('\n')[1]?.split('. ')[0] ?? 'See the guide.', steps, sources: [block.id], featureSummary: null });
});

describe('product-help chat API (T-175)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let tenant: SyntheticTenant;
  let key: CryptoKey;
  let bearer = '';
  const email = new CapturingEmailSender();
  const intake: FeatureRequestIntakeItem[] = [];
  const logLines: Record<string, unknown>[] = [];
  const session = (n: number) => `conversation-${String(n).padStart(8, '0')}`;

  async function post(url: string, body: Record<string, unknown>, options: { auth?: boolean; ip?: string } = {}) {
    const response = await app.inject({ method: 'POST', url, payload: body, headers: { ...(options.auth ? { authorization: `Bearer ${bearer}` } : {}), 'x-pactlab-client-ip': options.ip ?? '203.0.113.7' } });
    return { status: response.statusCode, body: response.json() as SupportChatReplyView & { status?: string; code?: string } };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    tenant = await createSyntheticTenant(db.owner, 'Help chat');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) logLines.push(JSON.parse(line) as Record<string, unknown>);
        done();
      },
    });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'info', destination }),
      documents: { gateway: new TransportClaudeGateway({ transport: model, registry: defaultPromptRegistry() }) },
      emailLogin: { tokenSecret: 'x'.repeat(48), emailSender: email },
      supportChat: { teamEmail: TEAM, featureIntake: { submit: async (item) => void intake.push(item) } },
    });
    bearer = await new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('answers a signed-out visitor on the site from the guides, with citations to pactlab.ai', async () => {
    const { status, body } = await post('/v1/public/support-chat/messages', { question: 'How does valuation work?', page: '/how-it-works/', sessionId: session(1) });
    expect(status).toBe(200);
    expect(body.kind).toBe('ANSWER');
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations.every((citation) => citation.href.startsWith('https://pactlab.ai/'))).toBe(true);
    expect(body.deepLink).toBeNull();
  });

  it('meters every model call like other AI jobs, with no conversation content', () => {
    const metered = logLines.filter((line) => line['event'] === 'ai.run.metered');
    expect(metered.length).toBeGreaterThan(0);
    expect(metered[0]).toMatchObject({ jobType: 'support_chat', surface: 'SITE', promptId: 'support.chat', status: 'SUCCEEDED' });
    expect(metered[0]!['inputTokens']).toBeGreaterThan(0);
    expect(JSON.stringify(metered)).not.toContain('valuation work');
  });

  it('says it does not know, and offers the email route, for a question outside the corpus', async () => {
    const { body } = await post('/v1/public/support-chat/messages', { question: 'What will the weather be in Paris tomorrow?', sessionId: session(2) });
    expect(body).toMatchObject({ kind: 'DONT_KNOW', offerEmail: true, citations: [] });
  });

  it('offers the log-it path for a feature Pactlab does not have, and logs it only when confirmed with an address', async () => {
    const { body } = await post('/v1/public/support-chat/messages', { question: 'Can you add a Slack integration?', sessionId: session(3) });
    expect(body).toMatchObject({ kind: 'FEATURE_REQUEST', featureRequest: { summary: 'a Slack integration' } });
    expect(body.text).toContain('Shall I log that for the team?');
    const handoff = { kind: 'FEATURE_REQUEST', confirmed: true, summary: 'a Slack integration', sessionId: session(3), transcript: [{ role: 'user', text: 'Can you add a Slack integration?' }] };
    expect((await post('/v1/public/support-chat/handoff', handoff)).status).toBe(422);
    expect((await post('/v1/public/support-chat/handoff', { ...handoff, confirmed: false, email: 'visitor@example.com' })).status).toBe(400);
    expect(intake).toHaveLength(0);
    expect((await post('/v1/public/support-chat/handoff', { ...handoff, email: 'visitor@example.com' })).body.status).toBe('SENT');
    expect(intake).toEqual([expect.objectContaining({ summary: 'a Slack integration', surface: 'SITE', requester: { kind: 'VISITOR', email: 'visitor@example.com' } })]);
  });

  it('emails an unanswered question to the team with the conversation, only on confirmation', async () => {
    const before = email.sent.length;
    const { body } = await post('/v1/public/support-chat/handoff', { kind: 'QUESTION', confirmed: true, email: 'visitor@example.com', summary: 'Do you support Lithuanian VAT?', sessionId: session(4), transcript: [{ role: 'user', text: 'Do you support Lithuanian VAT?' }] });
    expect(body.status).toBe('SENT');
    expect(email.sent.slice(before)).toEqual([expect.objectContaining({ to: TEAM, subject: 'Help question: Do you support Lithuanian VAT?' })]);
    expect(email.sent.at(-1)?.text).toContain('Reply to: visitor@example.com');
    expect(email.sent.at(-1)?.text).toContain('Visitor: Do you support Lithuanian VAT?');
  });

  it('needs a signed-in person for the in-app chat', async () => {
    expect((await post('/v1/support-chat/messages', { question: 'How do I map a sheet?', sessionId: session(5) })).status).toBe(401);
  });

  it('gives a signed-in user on the imports page the steps, with a deep link to that pact’s import screen', async () => {
    const { status, body } = await post('/v1/support-chat/messages', { question: 'How do I map a sheet?', page: `/deals/${DEAL}/sources/upload`, sessionId: session(6) }, { auth: true });
    expect(status).toBe(200);
    expect(body.kind).toBe('STEPS');
    expect(body.steps.length).toBeGreaterThanOrEqual(3);
    expect(body.deepLink).toEqual({ label: 'Open the import page', href: `/deals/${DEAL}/sources/upload` });
  });

  it('returns the boundary explanation, in the user’s locale, for any deal’s findings', async () => {
    const english = await post('/v1/support-chat/messages', { question: 'What are the findings on my deal?', page: `/deals/${DEAL}/findings`, sessionId: session(7) }, { auth: true });
    expect(english.body).toMatchObject({ kind: 'BOUNDARY', text: SUPPORT_MESSAGES.en.boundary, offerEmail: true });
    const german = await post('/v1/support-chat/messages', { locale: 'de', question: 'Welche Befunde hat der Deal?', page: `/deals/${DEAL}/findings`, sessionId: session(7) }, { auth: true });
    expect(german.body).toMatchObject({ kind: 'BOUNDARY', text: SUPPORT_MESSAGES.de.boundary, answeredIn: 'de' });
  });

  it('limits one site conversation, and says so plainly', async () => {
    let last: SupportChatReplyView | null = null;
    for (let i = 0; i < 21; i += 1) last = (await post('/v1/public/support-chat/messages', { question: 'What will the weather be?', sessionId: session(8), }, { ip: '198.51.100.9' })).body;
    expect(last).toMatchObject({ kind: 'LIMITED', text: SUPPORT_MESSAGES.en.limited });
  });

  it('refuses a malformed request', async () => {
    expect((await post('/v1/public/support-chat/messages', { question: '', sessionId: 'short' })).status).toBe(400);
    expect((await post('/v1/public/support-chat/messages', { question: 'Hi', sessionId: session(9), page: 'https://evil.example/' })).status).toBe(400);
  });
});
