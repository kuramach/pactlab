import type { ConnectionScope, DryRunResult, ValidationResult } from '../contract';
import {
  VDR_PROVIDER,
  VdrAdapterError,
  type VdrAdapter,
  type VdrConnectionConfig,
  type VdrDocumentPage,
  type VdrDocumentRef,
} from './types';

export const VDR_LIVE_VERSION = 'vdr-live-0';

const NOT_ENABLED = 'Live data-room reads are not enabled in this release';

/**
 * Configuration-only live adapter. It accepts the same config and credential
 * reference as the fixture adapter so switching mode needs no code or schema
 * change, but performs no provider calls until the primary VDR partner is
 * chosen and the client is verified against that provider's documented API.
 */
export class VdrLiveAdapter implements VdrAdapter {
  readonly provider = VDR_PROVIDER;
  readonly mode = 'LIVE' as const;
  readonly version = VDR_LIVE_VERSION;

  constructor(readonly config: VdrConnectionConfig) {}

  async validateConnection(scope: ConnectionScope): Promise<ValidationResult> {
    const hasCredential = scope.credentialRef !== null;
    return {
      ok: false,
      checks: [
        { name: 'reachability', status: 'FAIL', detail: NOT_ENABLED },
        {
          name: 'credentials',
          status: hasCredential ? 'SKIPPED' : 'FAIL',
          detail: hasCredential
            ? 'Credential reference present; not resolved while live reads are disabled'
            : 'A credential reference is required for live mode',
        },
        { name: 'scopes', status: 'SKIPPED', detail: NOT_ENABLED },
        { name: 'mappings', status: 'SKIPPED', detail: NOT_ENABLED },
      ],
    };
  }

  async dryRun(): Promise<DryRunResult<VdrDocumentRef>> {
    return { sample: [], truncated: false };
  }

  async listDocuments(): Promise<VdrDocumentPage> {
    throw new VdrAdapterError('NOT_ENABLED', NOT_ENABLED);
  }
}
