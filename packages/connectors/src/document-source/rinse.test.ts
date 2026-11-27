import { parseRinseManifest, rinseManifestSchema } from '@pactlab/contracts';
import { describe, expect, it } from 'vitest';
import { FixtureDocumentSourceAdapter } from './adapters';
import { matchRinsedFile, readRinsedArchive, readRinsedFolder, rinseDisposition, sourcePathOf } from './rinse';
import { RINSED_FIXTURE_MANIFEST, RINSED_FIXTURE_ROOM } from './rinse-room';

const rooms = { [RINSED_FIXTURE_ROOM.id]: RINSED_FIXTURE_ROOM, plain: { ...RINSED_FIXTURE_ROOM, id: 'plain', files: RINSED_FIXTURE_ROOM.files.slice(1) } };
const adapter = new FixtureDocumentSourceAdapter('onedrive', rooms);
const scope = { credentialRef: null };

describe('a folder finished in Pactlab Rinse (T-178)', () => {
  it('the hand-built manifest is a ready set the schema accepts', () => {
    expect(rinseManifestSchema.safeParse(RINSED_FIXTURE_MANIFEST).success).toBe(true);
    expect(RINSED_FIXTURE_MANIFEST.gaps.find((gap) => gap.input === 'MULTIFAMILY_OCCUPANCY')?.state).toBe('HAND_SOURCED');
    expect(RINSED_FIXTURE_MANIFEST.gaps.find((gap) => gap.input === 'MULTIFAMILY_DELINQUENCY')?.state).toBe('NOTED');
  });

  it('is read at sync time, and round-trips through the pact-side reader unchanged', async () => {
    const config = { folder: RINSED_FIXTURE_ROOM.id };
    const listing = await adapter.list(scope, config);
    const folder = await readRinsedFolder(adapter, scope, config, listing);
    expect(folder.status).toBe('READ');
    if (folder.status !== 'READ') return;
    expect(folder.manifest).toEqual(RINSED_FIXTURE_MANIFEST);
    // Every file in the folder is the file the manifest names, by path and SHA-256.
    for (const file of listing.filter((entry) => entry !== folder.manifestFile)) {
      const match = matchRinsedFile(folder, file, await adapter.read(scope, config, file));
      expect(typeof match === 'object' && match !== null, sourcePathOf(file)).toBe(true);
    }
  });

  it('says when a file changed after the rinse, and when a folder was not rinsed', async () => {
    const config = { folder: RINSED_FIXTURE_ROOM.id };
    const listing = await adapter.list(scope, config);
    const folder = await readRinsedFolder(adapter, scope, config, listing);
    const lease = listing.find((file) => file.name === 'Retail unit lease.md' && file.folder === 'Leases');
    expect(lease && matchRinsedFile(folder, lease, new TextEncoder().encode('edited later'))).toBe('CHANGED_SINCE_RINSE');
    expect(matchRinsedFile(folder, { folder: '', name: 'stray.md' }, new Uint8Array())).toBe('NOT_IN_MANIFEST');
    const plain = await readRinsedFolder(adapter, scope, { folder: 'plain' }, await adapter.list(scope, { folder: 'plain' }));
    expect(plain.status).toBe('NONE');
  });

  it('refuses a manifest that is not a ready, well-formed set', () => {
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(parseRinseManifest(new TextEncoder().encode('{nope')).problem).toBe('NOT_JSON');
    expect(parseRinseManifest(encode({ ...RINSED_FIXTURE_MANIFEST, extra: 1 })).problem).toBe('INVALID');
    const escaping = structuredClone(RINSED_FIXTURE_MANIFEST);
    (escaping.documents[0] as { converted: { path: string } }).converted.path = '../outside.md';
    expect(parseRinseManifest(encode(escaping)).problem).toBe('INVALID');
    const unresolved = structuredClone(RINSED_FIXTURE_MANIFEST);
    unresolved.documents[0]?.checks.push({ code: 'CONVERSION_MISMATCH', severity: 'ERROR', message: 'Total revenue differs.', resolution: null });
    expect(parseRinseManifest(encode(unresolved)).problem).toBe('INVALID');
    const open = structuredClone(RINSED_FIXTURE_MANIFEST);
    (open.gaps.find((gap) => gap.input === 'MULTIFAMILY_DELINQUENCY') as { state: string }).state = 'MISSING';
    expect(parseRinseManifest(encode(open)).problem).toBe('INVALID');
  });

  it('decides each file the same way for a sync and an archive: manifest, original, hand entry, copy, stray', async () => {
    const config = { folder: RINSED_FIXTURE_ROOM.id };
    const listing = await adapter.list(scope, config);
    const folder = await readRinsedFolder(adapter, scope, config, listing);
    expect(rinseDisposition(folder, { folder: '', name: 'pactlab-manifest.json' })).toEqual({ kind: 'MANIFEST' });
    expect(rinseDisposition(folder, { folder: 'Financials', name: 'Income statement FY2026.md' })).toEqual({ kind: 'SKIP', reason: 'RINSE_ORIGINAL' });
    expect(rinseDisposition(folder, { folder: 'hand-sourced', name: 'Vacancy and occupancy schedule.md' })).toEqual({ kind: 'SKIP', reason: 'HAND_SOURCED_CLAIM' });
    expect(rinseDisposition(folder, { folder: 'rinsed/Financials', name: 'Income statement FY2026.md' })).toMatchObject({ kind: 'READ', match: { role: 'CONVERTED' } });
    expect(rinseDisposition(folder, { folder: 'Rent roll', name: 'Rent roll Sept 2026.csv' })).toMatchObject({ kind: 'READ', match: { role: 'AS_IS' } });
    expect(rinseDisposition(folder, { folder: '', name: 'stray.md' })).toEqual({ kind: 'REFUSE', reason: 'NOT_IN_RINSE_MANIFEST' });
    expect(rinseDisposition({ status: 'NONE' }, { folder: '', name: 'stray.md' })).toEqual({ kind: 'ORDINARY' });
  });

  it('reads an archive of the set, at its root or wrapped in one top folder', () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const entries = RINSED_FIXTURE_ROOM.files.map((file) => ({ path: file.folder ? `${file.folder}/${file.name}` : file.name, bytes: encode(file.text) }));
    const root = readRinsedArchive(entries);
    expect(root.folder.status).toBe('READ');
    const wrapped = readRinsedArchive(entries.map((entry) => ({ ...entry, path: `Harbour Lane/${entry.path}` })));
    expect(wrapped.folder.status).toBe('READ');
    expect(wrapped.files.find((file) => file.name === 'Income statement FY2026.md')?.folder).toBe('Financials');
    if (wrapped.folder.status === 'READ') expect(wrapped.folder.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readRinsedArchive(entries.slice(1)).folder.status).toBe('NONE');
    expect(readRinsedArchive([{ path: 'pactlab-manifest.json', bytes: encode('{nope') }]).folder).toEqual({ status: 'INVALID', problem: 'NOT_JSON' });
  });
});
