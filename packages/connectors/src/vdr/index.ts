import type { ConnectionMode } from '../contract';
import { VdrFixtureAdapter } from './fixture.adapter';
import { VdrLiveAdapter } from './live.adapter';
import { vdrConnectionConfigSchema, type VdrAdapter, type VdrDocumentRef } from './types';

export * from './fixture.adapter';
export * from './live.adapter';
export * from './types';
export { VDR_FIXTURES } from './fixture-data';

/** The only place that looks at mode; callers see the normalized adapter. */
export function createVdrAdapter(mode: ConnectionMode, config: unknown): VdrAdapter | null {
  const parsed = vdrConnectionConfigSchema.safeParse(config);
  if (!parsed.success) return null;
  return mode === 'FIXTURE' ? new VdrFixtureAdapter(parsed.data) : new VdrLiveAdapter(parsed.data);
}

/** Read the whole visible room index; the bounded page size keeps each call small. */
export async function readRoomIndex(
  adapter: VdrAdapter,
  scope: Parameters<VdrAdapter['listDocuments']>[0],
  pageSize = 100,
): Promise<VdrDocumentRef[]> {
  const documents: VdrDocumentRef[] = [];
  let cursor: string | null = null;
  do {
    const page = await adapter.listDocuments(scope, { cursor, limit: pageSize });
    documents.push(...page.documents);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return documents;
}
