import type { ConnectionScope, DryRunResult, ProviderAdapter, ValidationResult } from '../contract';
import { STRIPE_PROVIDER } from './invoice-line';
import type { StripeSample } from './fixture.adapter';

/**
 * Live Stripe adapter: configuration only in this increment. It holds a
 * revocable credential reference (never a key) and reports itself not yet
 * reachable, so a LIVE connection can be configured and validated without
 * any provider call. Pulling live data lands with recorded cassettes.
 */
export class StripeLiveAdapter implements ProviderAdapter<StripeSample> {
  readonly provider = STRIPE_PROVIDER;
  readonly mode = 'LIVE' as const;

  async validateConnection(scope: ConnectionScope): Promise<ValidationResult> {
    const hasCredential = scope.credentialRef !== null;
    return {
      ok: false,
      checks: [
        {
          name: 'reachability',
          status: 'FAIL',
          detail: 'Live Stripe pulls are not enabled in this build; use FIXTURE mode',
        },
        {
          name: 'credentials',
          status: hasCredential ? 'SKIPPED' : 'FAIL',
          detail: hasCredential
            ? 'Credential reference recorded; not resolved until live pulls are enabled'
            : 'No credential reference configured',
        },
        {
          name: 'scopes',
          status: 'SKIPPED',
          detail: 'Read-only permissions are pinned when live pulls are enabled',
        },
        { name: 'mappings', status: 'PASS', detail: 'Invoice lines map to billing.invoice_line' },
      ],
    };
  }

  async dryRun(
    _scope: ConnectionScope,
    _options: { limit: number },
  ): Promise<DryRunResult<StripeSample>> {
    return { sample: [], truncated: false };
  }
}
