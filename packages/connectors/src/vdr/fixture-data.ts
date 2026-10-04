import { createHash } from 'node:crypto';
import type { VdrDocumentRef } from './types';

/**
 * Deterministic synthetic data rooms. Names and hashes are generated, not
 * recorded: no real documents, no customer data, no drift between runs.
 */
export interface VdrFixtureRoom {
  readonly room: string;
  readonly grantedPermissions: readonly string[];
  /** Folders the grant cannot see; their documents are absent from the index. */
  readonly restrictedFolders: readonly string[];
  readonly documents: readonly VdrDocumentRef[];
}

interface FolderPlan {
  readonly index: number;
  readonly path: string;
  readonly names: readonly string[];
}

const FOLDERS: readonly FolderPlan[] = [
  {
    index: 1,
    path: '1 Corporate',
    names: ['Certificate of Incorporation', 'Board Minutes', 'Cap Table'],
  },
  {
    index: 2,
    path: '2 Financial',
    names: ['Audited Financials', 'Management Accounts', 'ARR Bridge'],
  },
  {
    index: 3,
    path: '3 Commercial',
    names: ['Customer List', 'Master Subscription Agreement', 'Pricing'],
  },
  {
    index: 4,
    path: '4 Legal',
    names: ['Litigation Summary', 'IP Assignments', 'Material Contracts'],
  },
  {
    index: 5,
    path: '5 Technology',
    names: ['Architecture Overview', 'Security Policy', 'SBOM Summary'],
  },
];

function hash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function room(
  name: string,
  options: { copies: number; from: string; sparse?: boolean },
): VdrDocumentRef[] {
  const documents: VdrDocumentRef[] = [];
  const start = Date.parse(options.from);
  for (const folder of FOLDERS) {
    for (let copy = 0; copy < options.copies; copy += 1) {
      folder.names.forEach((title, position) => {
        const serial = copy * folder.names.length + position + 1;
        const id = `${name}:${folder.index}.${serial}`;
        // SparseCo: every fourth document lacks a hash, every fifth a timestamp,
        // and later copies reuse earlier names in sibling subfolders.
        const missingHash = options.sparse === true && serial % 4 === 0;
        const missingModified = options.sparse === true && serial % 5 === 0;
        documents.push({
          externalId: hash(id).slice(0, 24),
          indexNumber:
            options.sparse === true && serial % 7 === 0 ? null : `${folder.index}.${serial}`,
          folderPath: copy === 0 ? folder.path : `${folder.path}/Archive ${copy}`,
          name: `${title}.pdf`,
          version: 1 + (serial % 3),
          mediaType: 'application/pdf',
          sizeBytes: options.sparse === true && serial % 6 === 0 ? null : 20_000 + serial * 1_337,
          sha256: missingHash ? null : hash(`${id}:content`),
          modifiedAt: missingModified
            ? null
            : new Date(start + (folder.index * 10 + serial) * 86_400_000).toISOString(),
        });
      });
    }
  }
  return documents;
}

const ALL = ['index:read', 'document-metadata:read'];

export const VDR_FIXTURES: Readonly<Record<string, VdrFixtureRoom>> = {
  'healthyco/project-aurora': {
    room: 'healthyco/project-aurora',
    grantedPermissions: ALL,
    restrictedFolders: [],
    documents: room('healthyco', { copies: 1, from: '2026-06-01T00:00:00.000Z' }),
  },
  'troubledco/project-bramble': {
    room: 'troubledco/project-bramble',
    grantedPermissions: ALL,
    restrictedFolders: [],
    documents: room('troubledco', { copies: 2, from: '2026-05-01T00:00:00.000Z' }),
  },
  // Missing fields, pagination past one dry-run page, stale timestamps,
  // duplicate names and a folder the grant cannot see.
  'sparseco/project-cinder': {
    room: 'sparseco/project-cinder',
    grantedPermissions: ALL,
    restrictedFolders: ['4 Legal'],
    documents: room('sparseco', { copies: 5, from: '2023-01-01T00:00:00.000Z', sparse: true }),
  },
  'sparseco/metadata-locked': {
    room: 'sparseco/metadata-locked',
    grantedPermissions: ['index:read'],
    restrictedFolders: [],
    documents: room('sparseco-locked', { copies: 1, from: '2023-01-01T00:00:00.000Z' }),
  },
};
