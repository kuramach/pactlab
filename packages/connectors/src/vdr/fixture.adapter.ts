import {
  boundedLimit,
  type ConnectionScope,
  type DryRunResult,
  type ValidationCheck,
  type ValidationResult,
} from '../contract';
import { VDR_FIXTURES, type VdrFixtureRoom } from './fixture-data';
import {
  VDR_OPTIONAL_FIELDS,
  VDR_PROVIDER,
  VDR_REQUIRED_FIELDS,
  VDR_REQUIRED_PERMISSIONS,
  VdrAdapterError,
  type VdrAdapter,
  type VdrConnectionConfig,
  type VdrDocumentPage,
  type VdrDocumentRef,
} from './types';

export const VDR_FIXTURE_VERSION = 'vdr-fixture-1';
const MAX_PAGE = 100;

function isVisible(fixture: VdrFixtureRoom, document: VdrDocumentRef): boolean {
  return !fixture.restrictedFolders.some(
    (folder) => document.folderPath === folder || document.folderPath.startsWith(`${folder}/`),
  );
}

function missingCount(documents: readonly VdrDocumentRef[], field: keyof VdrDocumentRef): number {
  return documents.filter((document) => document[field] === null || document[field] === '').length;
}

/** Synthetic data rooms behind the same normalized interface as a live VDR. */
export class VdrFixtureAdapter implements VdrAdapter {
  readonly provider = VDR_PROVIDER;
  readonly mode = 'FIXTURE' as const;
  readonly version = VDR_FIXTURE_VERSION;

  constructor(private readonly config: VdrConnectionConfig) {}

  private fixture(): VdrFixtureRoom | undefined {
    return Object.hasOwn(VDR_FIXTURES, this.config.room)
      ? VDR_FIXTURES[this.config.room]
      : undefined;
  }

  private visibleDocuments(): readonly VdrDocumentRef[] {
    const fixture = this.fixture();
    if (!fixture) throw new VdrAdapterError('UNKNOWN_ROOM', 'Data room not found');
    if (!VDR_REQUIRED_PERMISSIONS.every((p) => fixture.grantedPermissions.includes(p)))
      throw new VdrAdapterError('PERMISSION_DENIED', 'Grant lacks document-metadata:read');
    return fixture.documents.filter((document) => isVisible(fixture, document));
  }

  async validateConnection(_scope: ConnectionScope): Promise<ValidationResult> {
    const fixture = this.fixture();
    const missing = VDR_REQUIRED_PERMISSIONS.filter(
      (permission) => !fixture?.grantedPermissions.includes(permission),
    );
    const restricted = fixture?.restrictedFolders ?? [];
    const scopesOk = fixture !== undefined && missing.length === 0 && restricted.length === 0;
    const documents = fixture && missing.length === 0 ? this.visibleDocuments() : [];
    const requiredGaps = VDR_REQUIRED_FIELDS.filter((field) => missingCount(documents, field) > 0);
    const optionalGaps = VDR_OPTIONAL_FIELDS.map(
      (field) => [field, missingCount(documents, field)] as const,
    )
      .filter(([, count]) => count > 0)
      .map(([field, count]) => `${field} missing on ${count}`);
    const checks: ValidationCheck[] = [
      {
        name: 'reachability',
        status: fixture ? 'PASS' : 'FAIL',
        detail: fixture ? 'Fixture data room available' : 'Data room is not an available fixture',
      },
      { name: 'credentials', status: 'SKIPPED', detail: 'Fixture mode uses no credentials' },
      {
        name: 'scopes',
        status: scopesOk ? 'PASS' : 'FAIL',
        detail:
          missing.length > 0
            ? `Missing permissions: ${missing.join(', ')}`
            : restricted.length > 0
              ? `Folders not visible to this grant: ${restricted.join(', ')}`
              : 'Read-only index and document-metadata access granted',
      },
      {
        name: 'mappings',
        status: documents.length > 0 && requiredGaps.length === 0 ? 'PASS' : 'FAIL',
        detail:
          documents.length === 0
            ? 'No readable documents in the room index'
            : requiredGaps.length > 0
              ? `Required fields missing: ${requiredGaps.join(', ')}`
              : optionalGaps.length > 0
                ? `${documents.length} documents mapped; ${optionalGaps.join('; ')}`
                : `${documents.length} documents mapped`,
      },
    ];
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  async dryRun(
    scope: ConnectionScope,
    options: { limit: number },
  ): Promise<DryRunResult<VdrDocumentRef>> {
    const page = await this.listDocuments(scope, {
      cursor: null,
      limit: boundedLimit(options.limit),
    });
    return { sample: page.documents, truncated: page.nextCursor !== null };
  }

  async listDocuments(
    _scope: ConnectionScope,
    options: { cursor: string | null; limit: number },
  ): Promise<VdrDocumentPage> {
    const documents = this.visibleDocuments();
    const limit = Math.min(Math.max(1, Math.trunc(options.limit)), MAX_PAGE);
    const offset = options.cursor === null ? 0 : Number(options.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > documents.length)
      throw new VdrAdapterError('INVALID_CURSOR', 'Invalid page cursor');
    const end = offset + limit;
    return {
      documents: documents.slice(offset, end),
      nextCursor: end < documents.length ? String(end) : null,
    };
  }
}
