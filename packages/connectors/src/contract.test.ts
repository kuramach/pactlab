import { describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { boundedLimit, type ConnectionScope, type ProviderAdapter } from './contract';
import { checkAdapterContract } from './testing';

class FixtureEchoAdapter implements ProviderAdapter<{ id: number }> {
  readonly provider = 'echo';
  readonly mode = 'FIXTURE' as const;
  async validateConnection() {
    return {
      ok: true,
      checks: (['reachability', 'credentials', 'scopes', 'mappings'] as const).map((name) => ({
        name,
        status: 'PASS' as const,
        detail: 'fixture',
      })),
    };
  }
  async dryRun(_scope: ConnectionScope, options: { limit: number }) {
    const limit = boundedLimit(options.limit);
    return { sample: Array.from({ length: limit }, (_, id) => ({ id })), truncated: true };
  }
}

describe('connector contract', () => {
  const scope: ConnectionScope = {
    organizationId: newId(),
    dealId: newId(),
    connectionId: newId(),
    credentialRef: null,
  };

  it('accepts a conforming fixture adapter', async () => {
    await expect(checkAdapterContract(new FixtureEchoAdapter(), scope)).resolves.toEqual([]);
  });

  it('flags an adapter that skips required validation checks', async () => {
    const adapter = new FixtureEchoAdapter();
    adapter.validateConnection = async () => ({ ok: true, checks: [] });
    const violations = await checkAdapterContract(adapter, scope);
    expect(violations.map((violation) => violation.rule)).toContain(
      'validateConnection reports reachability, credentials, scopes and mappings',
    );
  });

  it('bounds dry-run limits', () => {
    expect(boundedLimit(1000)).toBe(50);
    expect(() => boundedLimit(0)).toThrow();
  });
});
