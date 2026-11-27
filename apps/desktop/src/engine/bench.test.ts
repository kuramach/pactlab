import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRinseManifest, RINSE_MANIFEST_FILE } from '@pactlab/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { AiQueue } from './ai-queue';
import { Bench } from './bench';
import { BundledConverter, ConversionError } from './converter';
import { BALANCE_LINES, docx, INCOME_LINES } from './fixture-set';
import { PactlabApi, preparerUserId, SessionStore } from './pactlab';
import { handle, type SidecarContext, type SidecarRequest } from './sidecar';

const USER = '0193a1b2-0000-7000-8000-00000000a001';
const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const binding = { bindingId: '0195d1c2-0000-7000-8000-000000000001', organizationId: '0195d1c2-0000-7000-8000-000000000002', dealId: '0195d1c2-0000-7000-8000-000000000003', pactName: 'Project Harbour Lane', invitedBy: 'Rinse Buyers', boundAt: '2026-11-27T10:00:00.000Z' };

const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0)) await rm(folder, { recursive: true, force: true });
});
const folder = async (prefix: string) => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the replies are read loosely, as the window reads them
type Reply = { ok: boolean; result?: any; code?: string };

async function context(): Promise<{ ask: (request: object) => Promise<Reply>; sessions: SessionStore }> {
  const dir = await folder('rinse-bench-');
  const sessions = new SessionStore(join(dir, 'session.json'));
  const api = new PactlabApi('https://app.pactlab.test', async () => new Response('{}', { status: 503 }));
  const queue = AiQueue.memory();
  const ctx: SidecarContext = {
    api,
    sessions,
    queue,
    pageImage: async () => new Uint8Array(),
    device: 'test',
    bench: new Bench({ api, loadSession: () => sessions.load(), queue, converter: new BundledConverter(null, null), pageImage: async () => new Uint8Array(), cloudClients: {} }),
  };
  let id = 0;
  return { ask: (request) => handle(ctx, { id: (id += 1), ...request } as SidecarRequest) as never, sessions };
}

describe('the bench the window drives (T-178e)', () => {
  it('names the preparer from the session token’s own subject', () => {
    expect(preparerUserId(jwt({ sub: `pactlab|${USER}` }))).toBe(USER);
    expect(preparerUserId(jwt({ sub: 'auth0|abc' }))).toBeNull();
    expect(preparerUserId('not-a-token')).toBeNull();
  });

  it('opens a folder only for a signed-in, named preparer, then rinses offline to a finished folder', async () => {
    const { ask, sessions } = await context();
    const source = await folder('rinse-source-');
    await mkdir(join(source, 'Financials'));
    await writeFile(join(source, 'Financials/Income statement FY2026.docx'), docx(INCOME_LINES));
    const balance = join(await folder('rinse-extra-'), 'Balance sheet.docx');
    await writeFile(balance, docx(BALANCE_LINES));
    const open = { command: 'set.open', folder: source, name: 'Harbour Lane (synthetic)', companyType: 'MULTIFAMILY', currency: 'USD', bindingId: binding.bindingId };

    expect(await ask(open)).toMatchObject({ ok: false, code: 'SIGNED_OUT' });
    await sessions.save({ origin: 'https://app.pactlab.test', email: 'dana@harbour.example', token: jwt({ sub: `pactlab|${USER}` }), expiresAt: '2099-01-01T00:00:00.000Z', bindings: [binding] });
    expect(await ask(open)).toMatchObject({ ok: false, code: 'PREPARER_UNKNOWN' });
    await sessions.save({ ...(await sessions.load())!, name: 'Dana Whitlow', organization: 'Harbour Lane Apartments LLC (synthetic)' });
    expect(await ask({ ...open, bindingId: '0195d1c2-0000-7000-8000-0000000000ff' })).toMatchObject({ ok: false, code: 'NOT_BOUND' });

    const opened = await ask(open);
    expect(opened).toMatchObject({ ok: true, result: { open: true, name: 'Harbour Lane (synthetic)' } });
    // Offline, with no AI and no bundled tools: the deterministic steps still run.
    let state = (await ask({ command: 'set.rinse', online: false })).result;
    expect(state.view.files[0]).toMatchObject({ path: 'Financials/Income statement FY2026.docx', audit: { figuresMatched: 3, mismatches: [] } });
    expect(state.view.readiness.ready).toBe(false);
    expect(await ask({ command: 'set.write', parent: source })).toMatchObject({ ok: false, code: 'NOT_READY' });

    // The seller closes each gap: a file for the gap, a hand entry, notes for the rest.
    state = (await ask({ command: 'set.addFile', path: balance, input: 'BALANCE_SHEET' })).result;
    expect(state.view.gaps.find((gap: { input: string }) => gap.input === 'BALANCE_SHEET').state).toMatch(/^PRESENT/);
    const income = state.view.files.find((file: { path: string }) => file.path.startsWith('Financials/'));
    const bad = (await ask({ command: 'set.handEntry', form: 'VACANCY_SCHEDULE', rows: [{ period: '2026-09', unitType: 'All', units: 'many', occupiedUnits: '106' }], entryId: null })).result;
    expect(bad.problems).toContainEqual(expect.objectContaining({ field: 'units', problem: 'NOT_A_COUNT' }));
    await ask({ command: 'set.handEntry', form: 'VACANCY_SCHEDULE', rows: [{ period: '2026-09', unitType: 'All', units: '120', occupiedUnits: '106' }], entryId: null });
    state = (await ask({ command: 'set.rinse', online: false })).result;
    for (const gap of state.view.gaps.filter((entry: { state: string; need: string }) => entry.state === 'MISSING' && entry.need === 'REQUIRED')) {
      expect(await ask({ command: 'set.noteGap', input: gap.input, kind: 'NOTED', note: 'Follows next week from the manager.' })).toMatchObject({ ok: true });
    }
    expect(await ask({ command: 'set.noteGap', input: 'LEASE', kind: 'NOTED', note: 'x' })).toMatchObject({ ok: false, code: 'NOTE_REQUIRED' });
    state = (await ask({ command: 'set.view' })).result;
    // Offline, nothing is classified by AI: the seller's own classification of each file closes the rest.
    for (const file of state.view.files.filter((entry: { checks: { severity: string; resolution: unknown }[] }) => entry.checks.some((item) => item.severity === 'ERROR' && !item.resolution))) {
      await ask({ command: 'set.exclude', fileId: file.id });
    }
    state = (await ask({ command: 'set.view' })).result;
    expect(state.view.readiness).toMatchObject({ openErrors: 0, openGaps: [] });
    expect(income).toBeDefined();

    const out = await folder('rinse-out-');
    const written = (await ask({ command: 'set.write', parent: out })).result.written;
    expect(written.location).toBe(join(out, 'Harbour Lane (synthetic)'));
    const manifest = parseRinseManifest(new Uint8Array(await readFile(join(written.location, RINSE_MANIFEST_FILE)))).manifest;
    expect(manifest).toMatchObject({ set: { preparedBy: { userId: USER, name: 'Dana Whitlow' }, intendedPact: { dealId: binding.dealId, bindingId: binding.bindingId } } });
    // Never overwritten: writing the same set again is refused.
    expect(await ask({ command: 'set.write', parent: out })).toMatchObject({ ok: false, code: 'EXISTS' });
  });

  it('keeps a drive that is not registered off, and fails closed on a format only a bundled tool reads', async () => {
    const { ask } = await context();
    expect(await ask({ command: 'cloud.status' })).toMatchObject({ ok: true, result: { cloud: [{ provider: 'ONEDRIVE', registered: false, signedIn: false }, { provider: 'GOOGLE_DRIVE', registered: false }, { provider: 'BOX', registered: false }] } });
    expect(await ask({ command: 'cloud.signIn', provider: 'ONEDRIVE' })).toMatchObject({ ok: false, code: 'CLOUD_REFUSED' });
    expect(await ask({ command: 'set.upload', provider: 'ONEDRIVE' })).toMatchObject({ ok: false, code: 'CLOUD_SIGNED_OUT' });
    await expect(new BundledConverter(null, null).convert('scan.png', new Uint8Array([0x89, 0x50]))).rejects.toEqual(new ConversionError('TOOL_MISSING'));
    await expect(new BundledConverter(null, null).convert('Deck.pptx', new Uint8Array())).rejects.toEqual(new ConversionError('TOOL_MISSING'));
  });
});
