import { COMPANY_TYPES, type CompanyType } from '../pacts/types';

/**
 * The packs on sale (Kumar, 2026-11-01): Pactlab launches with Software & SaaS
 * and Multifamily, and releases the others one at a time, each after testing.
 * Venture Raise released 2026-11-09 (Kumar).
 * Releasing a pack is adding it here, in a reviewed change. The public site
 * keeps the same list (apps/site/lib/industry-stories.ts, RELEASED_INDUSTRY_SLUGS).
 *
 * Preview (dev, qa, local and tests) shows every company type, so the next
 * pack can be tested before release; stage and production show only these.
 */
export const RELEASED_COMPANY_TYPES: readonly CompanyType[] = ['SOFTWARE_SAAS', 'MULTIFAMILY', 'VENTURE_RAISE'];

export function isReleasedCompanyType(type: CompanyType): boolean {
  return RELEASED_COMPANY_TYPES.includes(type);
}

/** The company types a new pact may be started as. */
export function selectableCompanyTypes(preview: boolean): readonly CompanyType[] {
  return preview ? COMPANY_TYPES : RELEASED_COMPANY_TYPES;
}
