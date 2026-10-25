import { ECOMMERCE_RULES, FINTECH_RULES, HEALTHCARE_RULES, MULTIFAMILY_RULES, PHARMA_RULES, SERVICES_RULES, TELECOM_RULES, type PackRule } from '@pactlab/calculations';
import { PACKS, type FindingRule, type PackDefinition, type PackId } from '@pactlab/domain';

/**
 * The pack and rule registries the findings module reads. Rule code lives in
 * `@pactlab/calculations` (decimal arithmetic); this is where it becomes the
 * domain's `FindingRule` — the assignment below is the structural check that
 * the two shapes still agree. Tests may pass their own registries through
 * `AppDependencies.packs`.
 */
export interface PackRegistry {
  readonly packs: Readonly<Record<PackId, PackDefinition>>;
  readonly rules: Readonly<Record<string, FindingRule>>;
}

const asFindingRule = (rule: PackRule): FindingRule => rule;

export const PACK_RULES: Readonly<Record<string, FindingRule>> = Object.fromEntries(
  [...FINTECH_RULES, ...MULTIFAMILY_RULES, ...HEALTHCARE_RULES, ...TELECOM_RULES, ...SERVICES_RULES, ...PHARMA_RULES, ...ECOMMERCE_RULES].map((rule) => [rule.id, asFindingRule(rule)]),
);

export const PACK_REGISTRY = Symbol('PACK_REGISTRY');
export const DEFAULT_PACK_REGISTRY: PackRegistry = { packs: PACKS, rules: PACK_RULES };

/** Above this, the run refuses rather than read a partial evidence set. */
/** The bounded pack-evidence read (shared with metrics; see packs/pack-evidence.ts). */
export { MAX_PACK_EVIDENCE as MAX_RULE_EVIDENCE } from '../packs/pack-evidence';

/**
 * Document classes a rule may read. Never HR, compensation, performance or
 * named contribution (rule 7) — the same classes the AI gateway refuses.
 */
export const RULE_READABLE_CLASSES = ['PUBLIC', 'BUSINESS', 'FINANCIAL'] as const;
