import type { ConnectionScope, ProviderAdapter } from './contract';
import { DRY_RUN_MAX_LIMIT } from './contract';

export interface ContractViolation {
  readonly rule: string;
}

/**
 * Adapter parity checks shared by fixture and live adapters. Each provider's
 * test suite runs this against both implementations.
 */
export async function checkAdapterContract<TRecord>(
  adapter: ProviderAdapter<TRecord>,
  scope: ConnectionScope,
): Promise<ContractViolation[]> {
  const violations: ContractViolation[] = [];
  const validation = await adapter.validateConnection(scope);
  const names = validation.checks.map((check) => check.name).sort();
  if (names.join(',') !== 'credentials,mappings,reachability,scopes') {
    violations.push({ rule: 'validateConnection reports reachability, credentials, scopes and mappings' });
  }
  if (validation.ok !== validation.checks.every((check) => check.status !== 'FAIL')) {
    violations.push({ rule: 'validateConnection ok flag matches its checks' });
  }
  const dryRun = await adapter.dryRun(scope, { limit: DRY_RUN_MAX_LIMIT + 10 });
  if (dryRun.sample.length > DRY_RUN_MAX_LIMIT) {
    violations.push({ rule: 'dryRun is bounded' });
  }
  return violations;
}
