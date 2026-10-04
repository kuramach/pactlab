import { newId } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { checkAdapterContract } from '../testing';
import { createVdrAdapter, readRoomIndex, VdrFixtureAdapter, VdrLiveAdapter } from './index';

const scope = () => ({
  organizationId: newId(),
  dealId: newId(),
  connectionId: newId(),
  credentialRef: null,
});

describe('VDR adapters', () => {
  it('fixture and live adapters satisfy the connector contract', async () => {
    const config = { room: 'healthyco/project-aurora' };
    await expect(checkAdapterContract(new VdrFixtureAdapter(config), scope())).resolves.toEqual([]);
    await expect(checkAdapterContract(new VdrLiveAdapter(config), scope())).resolves.toEqual([]);
  });

  it('selects by mode with one config shape and rejects malformed config', () => {
    const config = { room: 'healthyco/project-aurora' };
    expect(createVdrAdapter('FIXTURE', config)?.mode).toBe('FIXTURE');
    expect(createVdrAdapter('LIVE', config)?.mode).toBe('LIVE');
    expect(createVdrAdapter('FIXTURE', { room: '../../etc' })).toBeNull();
    expect(createVdrAdapter('LIVE', { room: 'a/b', apiKey: 'secret' })).toBeNull();
  });

  it('live adapter is configuration-only and makes no provider calls', async () => {
    const live = new VdrLiveAdapter({ room: 'healthyco/project-aurora' });
    const validation = await live.validateConnection(scope());
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'credentials')?.status).toBe('FAIL');
    await expect(live.listDocuments()).rejects.toMatchObject({ code: 'NOT_ENABLED' });
  });

  it('HealthyCo validates cleanly and returns index metadata only', async () => {
    const adapter = new VdrFixtureAdapter({ room: 'healthyco/project-aurora' });
    const validation = await adapter.validateConnection(scope());
    expect(validation.ok).toBe(true);
    expect(validation.checks.find((check) => check.name === 'mappings')?.detail).toBe(
      '15 documents mapped',
    );
    const documents = await readRoomIndex(adapter, scope());
    expect(documents).toHaveLength(15);
    expect(Object.keys(documents[0]!).sort()).toEqual([
      'externalId',
      'folderPath',
      'indexNumber',
      'mediaType',
      'modifiedAt',
      'name',
      'sha256',
      'sizeBytes',
      'version',
    ]);
    expect(documents.every((document) => document.sha256?.length === 64)).toBe(true);
  });

  it('pages deterministically and rejects invalid cursors', async () => {
    const adapter = new VdrFixtureAdapter({ room: 'sparseco/project-cinder' });
    const first = await adapter.listDocuments(scope(), { cursor: null, limit: 25 });
    expect(first.documents).toHaveLength(25);
    expect(first.nextCursor).toBe('25');
    const all = await readRoomIndex(adapter, scope(), 7);
    expect(all).toEqual(await readRoomIndex(adapter, scope()));
    expect(new Set(all.map((document) => document.externalId)).size).toBe(all.length);
    const dry = await adapter.dryRun(scope(), { limit: 500 });
    expect(dry.sample).toHaveLength(50);
    expect(dry.truncated).toBe(true);
    await expect(adapter.listDocuments(scope(), { cursor: '-1', limit: 5 })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });

  it('SparseCo surfaces restricted folders and missing fields instead of hiding them', async () => {
    const adapter = new VdrFixtureAdapter({ room: 'sparseco/project-cinder' });
    const validation = await adapter.validateConnection(scope());
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'scopes')).toMatchObject({
      status: 'FAIL',
      detail: 'Folders not visible to this grant: 4 Legal',
    });
    const mappings = validation.checks.find((check) => check.name === 'mappings');
    expect(mappings?.status).toBe('PASS');
    expect(mappings?.detail).toMatch(/sha256 missing on \d+; modifiedAt missing on \d+/);

    const documents = await readRoomIndex(adapter, scope());
    expect(documents).toHaveLength(60);
    expect(documents.some((document) => document.folderPath.startsWith('4 Legal'))).toBe(false);
    const names = documents.map((document) => document.name);
    expect(new Set(names).size).toBeLessThan(names.length);
    expect(documents.some((document) => document.indexNumber === null)).toBe(true);
    expect(documents.every((d) => d.modifiedAt === null || d.modifiedAt < '2024-01-01')).toBe(true);
  });

  it('a grant without document metadata fails validation and denies reads', async () => {
    const adapter = new VdrFixtureAdapter({ room: 'sparseco/metadata-locked' });
    const validation = await adapter.validateConnection(scope());
    expect(validation.checks.find((check) => check.name === 'scopes')?.detail).toBe(
      'Missing permissions: document-metadata:read',
    );
    await expect(adapter.listDocuments(scope(), { cursor: null, limit: 5 })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    const unknown = new VdrFixtureAdapter({ room: 'nobody/nothing' });
    expect((await unknown.validateConnection(scope())).ok).toBe(false);
  });
});
