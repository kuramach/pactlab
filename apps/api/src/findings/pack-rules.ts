import { FINDING_RULES, PACKS, type FindingRule, type PackDefinition, type PackId } from '@pactlab/domain';

/**
 * The pack and rule registries the findings module reads. Production uses the
 * domain registries; tests may pass their own (a test-only rule) through
 * `AppDependencies.packs`, since no pack ships rules before T-058.
 */
export interface PackRegistry {
  readonly packs: Readonly<Record<PackId, PackDefinition>>;
  readonly rules: Readonly<Record<string, FindingRule>>;
}

export const PACK_REGISTRY = Symbol('PACK_REGISTRY');
export const DEFAULT_PACK_REGISTRY: PackRegistry = { packs: PACKS, rules: FINDING_RULES };

/** Above this, the run refuses rather than read a partial evidence set. */
export const MAX_RULE_EVIDENCE = 200_000;
