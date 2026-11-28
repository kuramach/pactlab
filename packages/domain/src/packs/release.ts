import { COMPANY_TYPES, type CompanyType } from '../pacts/types';

/**
 * The packs on sale (Kumar, 2026-11-01): Pactlab launches with Software & SaaS
 * and Multifamily, and releases the others one at a time, each after testing.
 * Venture Raise released 2026-11-09 (Kumar). Music rights released with its pack (T-140, Kumar 2026-11-19).
 * Energy generation & rights released with its pack (T-142, Kumar 2026-11-19).
 * Startup equity SPV released with its pack (T-141, Kumar 2026-11-19).
 * Fintech released with its payments and licence checks (T-159, Kumar 2026-11-26).
 * Healthcare released with its payer-mix, denial and credentialing checks (T-160, Kumar 2026-11-26).
 * Small clinics released with its owner-operator, referral and premises checks (T-161, Kumar 2026-11-26).
 * Pharma & biotech released with its pipeline, patent and obligation checks (T-163, Kumar 2026-11-26).
 * E-commerce & DTC released with its channel, cohort-value and platform checks (T-164, Kumar 2026-11-26).
 * IT & professional services released with its realization, concentration and covenant checks (T-167, Kumar 2026-11-26).
 * Telecom & media released with its subscriber claims, rights-window and concentration checks (T-168, Kumar 2026-11-26).
 * Hospitals released with its cost-report, payer-contract, medical-staff, plant and quality checks (T-162, Kumar 2026-11-26).
 * Hotels released with its franchise, PIP, management-contract, performance-claims and brand-fee checks (T-166, Kumar 2026-11-26).
 * Releasing a pack is adding it here, in a reviewed change. The public site
 * keeps the same list (apps/site/lib/industry-stories.ts, RELEASED_INDUSTRY_SLUGS).
 *
 * Preview (dev, qa, local and tests) shows every company type, so the next
 * pack can be tested before release; stage and production show only these.
 */
export const RELEASED_COMPANY_TYPES: readonly CompanyType[] = ['SOFTWARE_SAAS', 'MULTIFAMILY', 'VENTURE_RAISE', 'MUSIC_RIGHTS', 'ENERGY_GENERATION', 'STARTUP_SPV', 'FINTECH', 'HEALTHCARE', 'SMALL_CLINICS', 'PHARMA_BIOTECH', 'ECOMMERCE_DTC', 'PROFESSIONAL_SERVICES', 'TELECOM_MEDIA', 'HOSPITALS', 'HOTELS'];

export function isReleasedCompanyType(type: CompanyType): boolean {
  return RELEASED_COMPANY_TYPES.includes(type);
}

/** The company types a new pact may be started as. */
export function selectableCompanyTypes(preview: boolean): readonly CompanyType[] {
  return preview ? COMPANY_TYPES : RELEASED_COMPANY_TYPES;
}
