import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiQueue } from './ai-queue';
import { HttpRinseAiClient, PactlabApi, PactlabApiError, SessionStore, signedIn, type CachedSession } from './pactlab';

type Call = { url: string; init: RequestInit };
const binding = { bindingId: '0195d1c2-0000-7000-8000-000000000001', organizationId: '0195d1c2-0000-7000-8000-000000000002', dealId: '0195d1c2-0000-7000-8000-000000000003', pactName: 'Project Harbour Lane', invitedBy: 'Rinse Buyers', boundAt: '2026-11-27T10:00:00.000Z' };

function stand(responses: Record<string, unknown>, calls: Call[], status = 200) {
  return async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(responses[path] ?? { code: 'NOT_FOUND' }), { status: responses[path] ? status : 404, headers: { 'content-type': 'application/json' } });
  };
}

describe('the desktop’s Pactlab sign-in and AI jobs (T-178b)', () => {
  it('signs in from an invite, keeps the session owner-only, and opens offline on it', async () => {
    const calls: Call[] = [];
    const api = new PactlabApi('https://app.pactlab.test', stand({ '/v1/rinse/sign-in/start': { sent: true }, '/v1/rinse/sign-in/verify': { token: 't0k', expiresAt: '2099-01-01T00:00:00.000Z', bindings: [binding] } }, calls));
    await api.startSignIn({ token: 'i'.repeat(43), email: 'dana@harbour.example', displayName: 'Dana' });
    const session = await api.verifySignIn({ token: 'i'.repeat(43), email: 'Dana@Harbour.example', code: '123456', device: 'Pactlab Rinse' });
    expect(session).toMatchObject({ email: 'dana@harbour.example', token: 't0k', bindings: [binding] });
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ trust: '30d' });
    expect(calls.every((call) => call.init.redirect === 'manual')).toBe(true);

    const store = new SessionStore(join(await mkdtemp(join(tmpdir(), 'rinse-')), 'session.json'));
    await store.save(session);
    expect((await stat(join(store['path'])).then((s) => s.mode)) & 0o777).toBe(0o600);
    expect(signedIn(await store.load())).toBe(true);
    expect(signedIn({ ...session, expiresAt: '2000-01-01T00:00:00.000Z' })).toBe(false);
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(() => new PactlabApi('http://app.pactlab.test')).toThrow();
  });

  it('runs classification before vision, never sends people data to vision, and keeps failed jobs queued', async () => {
    const calls: Call[] = [];
    const session: CachedSession = { origin: 'https://app.pactlab.test', email: 'dana@harbour.example', token: 't0k', expiresAt: '2099-01-01T00:00:00.000Z', bindings: [binding] };
    const people = { '/v1/rinse/ai/classify': { category: 'PEOPLE_RECORD', confidence: 0.97, promptVersion: 'document.classify@1', aiExcluded: true } };
    const client = new HttpRinseAiClient(new PactlabApi(session.origin, stand(people, calls)), session, { bindingId: binding.bindingId, pack: 'MULTIFAMILY' });
    const queue = AiQueue.memory();
    await queue.enqueue({ kind: 'VISION', sha256: 'a', fileName: 'HR/Payroll scan.pdf', pages: 1 });
    await queue.enqueue({ kind: 'CLASSIFY', sha256: 'a', fileName: 'HR/Payroll scan.pdf', pageTexts: [''], categories: [] });
    expect(await queue.drain(client, async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({ ran: 1, waiting: 0 });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/v1/rinse/ai/classify']);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ bindingId: binding.bindingId, pack: 'MULTIFAMILY', fileName: 'Payroll scan.pdf', folder: 'HR' });
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer t0k');

    // Rate-limited or offline: the job stays queued.
    const limited = new HttpRinseAiClient(new PactlabApi(session.origin, stand({ '/v1/rinse/ai/classify': { code: 'RINSE_AI_RATE_LIMITED' } }, [], 429)), session, { bindingId: binding.bindingId, pack: 'MULTIFAMILY' });
    const second = AiQueue.memory();
    await second.enqueue({ kind: 'CLASSIFY', sha256: 'b', fileName: 'Rent roll.csv', pageTexts: ['Unit'], categories: [] });
    expect(await second.drain(limited, async () => new Uint8Array())).toEqual({ ran: 0, waiting: 1 });
    await expect(limited.classify({ kind: 'CLASSIFY', sha256: 'b', fileName: 'x', pageTexts: ['y'], categories: [] })).rejects.toBeInstanceOf(PactlabApiError);
  });

  it('sends page images to the vision lane only as PNG or JPEG', async () => {
    const calls: Call[] = [];
    const session: CachedSession = { origin: 'https://app.pactlab.test', email: 'd@h.example', token: 't', expiresAt: '2099-01-01T00:00:00.000Z', bindings: [binding] };
    const client = new HttpRinseAiClient(new PactlabApi(session.origin, stand({ '/v1/rinse/ai/vision': { text: 'Rent roll', promptVersion: 'document.vision@1' } }, calls)), session, { bindingId: binding.bindingId, pack: 'MULTIFAMILY' });
    expect(await client.readPages({ kind: 'VISION', sha256: 'c', fileName: 'scan.pdf', pages: 2 }, async () => new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toEqual(['Rent roll', 'Rent roll']);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ page: 1, image: { format: 'jpeg' } });
    await expect(client.readPages({ kind: 'VISION', sha256: 'c', fileName: 'scan.pdf', pages: 1 }, async () => new TextEncoder().encode('%PDF-1.7'))).rejects.toMatchObject({ code: 'PAGE_IMAGE_UNAVAILABLE' });
  });
});
