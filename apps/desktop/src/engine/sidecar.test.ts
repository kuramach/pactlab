import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiQueue } from './ai-queue';
import { PactlabApi, SessionStore } from './pactlab';
import { handle, type SidecarContext, type SidecarRequest } from './sidecar';

type Ask = SidecarRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;
const binding = { bindingId: '0195d1c2-0000-7000-8000-000000000001', organizationId: '0195d1c2-0000-7000-8000-000000000002', dealId: '0195d1c2-0000-7000-8000-000000000003', pactName: 'Project Harbour Lane', invitedBy: 'Rinse Buyers', boundAt: '2026-11-27T10:00:00.000Z' };

describe('the engine sidecar (T-178b)', () => {
  it('signs in, keeps the session across restarts, and holds AI jobs while offline or signed out', async () => {
    const paths: string[] = [];
    const api = new PactlabApi('https://app.pactlab.test', async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      const body = path.endsWith('/verify') ? { token: 't0k', expiresAt: '2099-01-01T00:00:00.000Z', bindings: [binding] } : path.endsWith('/classify') ? { category: 'LEASE', confidence: 0.9, promptVersion: 'document.classify@1', aiExcluded: false } : { sent: true };
      return new Response(JSON.stringify(body), { status: path.endsWith('/start') ? 202 : 200 });
    });
    const dir = await mkdtemp(join(tmpdir(), 'rinse-sidecar-'));
    const context: SidecarContext = { api, sessions: new SessionStore(join(dir, 'session.json')), queue: AiQueue.memory(), pageImage: async () => new Uint8Array(), device: 'test' };
    const ask = (request: Ask) => handle(context, { id: 1, ...request } as SidecarRequest);

    await context.queue.enqueue({ kind: 'CLASSIFY', sha256: 'a', fileName: 'Lease.pdf', pageTexts: ['Lease'], categories: [] });
    expect(await ask({ command: 'ai.drain', bindingId: binding.bindingId, pack: 'MULTIFAMILY', online: true })).toMatchObject({ ok: true, result: { ran: 0, waiting: 1 } });
    expect(await ask({ command: 'session.start', token: 'i'.repeat(43), email: 'dana@harbour.example', displayName: 'Dana' })).toMatchObject({ ok: true });
    expect(await ask({ command: 'session.verify', token: 'i'.repeat(43), email: 'dana@harbour.example', code: '123456' })).toMatchObject({ ok: true, result: { signedIn: true, bindings: [binding], waiting: 1 } });

    // A restart: a new context on the same files is still signed in, offline too.
    const restarted = { ...context, sessions: new SessionStore(join(dir, 'session.json')) };
    expect(await handle(restarted, { id: 2, command: 'session.status' })).toMatchObject({ ok: true, result: { signedIn: true, email: 'dana@harbour.example' } });
    expect(await ask({ command: 'ai.drain', bindingId: binding.bindingId, pack: 'MULTIFAMILY', online: false })).toMatchObject({ result: { ran: 0, waiting: 1 } });
    expect(await ask({ command: 'ai.drain', bindingId: binding.bindingId, pack: 'MULTIFAMILY', online: true })).toMatchObject({ result: { ran: 1, waiting: 0 } });
    expect(paths.at(-1)).toBe('/v1/rinse/ai/classify');

    expect(await ask({ command: 'session.signOut' })).toMatchObject({ result: { signedIn: false, bindings: [] } });
    expect(await handle(context, { id: 3, command: 'files.delete' } as unknown as SidecarRequest)).toEqual({ id: 3, ok: false, code: 'UNKNOWN_COMMAND' });
  });
});
