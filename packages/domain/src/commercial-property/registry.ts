/**
 * Commercial property (T-165, ADR 0055): the rent roll against the leases, recoveries and expiry cliffs.
 * This file is the registry of the codes the commercial-property imports use and the words the Leases
 * page carries. Pactlab reconciles documents and arithmetic: it never values or appraises the property.
 */

/** Where a capex schedule project stands, as the seller's schedule records it. */
export const CRE_CAPEX_STATUSES = ['planned', 'committed', 'completed'] as const;
export type CreCapexStatus = (typeof CRE_CAPEX_STATUSES)[number];
export const CRE_CAPEX_STATUS_LABELS = {
  planned: 'Planned',
  committed: 'Committed',
  completed: 'Completed',
} as const satisfies Record<CreCapexStatus, string>;

/** How a lease shares the property's operating costs, as the lease states it. */
export const CRE_LEASE_TYPES = ['NET', 'GROSS', 'NOT_STATED'] as const;
export type CreLeaseType = (typeof CRE_LEASE_TYPES)[number];
export const CRE_LEASE_TYPE_LABELS = {
  NET: 'Net (NNN): the tenant pays its share of recoverable expenses',
  GROSS: 'Gross: expenses are included in the rent',
  NOT_STATED: 'Not stated in the lease',
} as const satisfies Record<CreLeaseType, string>;

/** How a rent-roll row stands against its lease. */
export const CRE_RENT_CHECK_STATES = ['MATCHES', 'OVERSTATED', 'UNDERSTATED', 'NO_LEASE'] as const;
export type CreRentCheckState = (typeof CRE_RENT_CHECK_STATES)[number];
export const CRE_RENT_CHECK_LABELS = {
  MATCHES: 'Matches the lease',
  OVERSTATED: 'Rent roll above the lease',
  UNDERSTATED: 'Rent roll below the lease',
  NO_LEASE: 'No lease read for this suite',
} as const satisfies Record<CreRentCheckState, string>;

/** What an entry in the obligations register is. */
export const CRE_OBLIGATION_KINDS = ['TENANT_IMPROVEMENT', 'LEASING_COMMISSION', 'COMMITTED_CAPEX'] as const;
export type CreObligationKind = (typeof CRE_OBLIGATION_KINDS)[number];
export const CRE_OBLIGATION_KIND_LABELS = {
  TENANT_IMPROVEMENT: 'Tenant improvement allowance',
  LEASING_COMMISSION: 'Leasing commission',
  COMMITTED_CAPEX: 'Committed capex',
} as const satisfies Record<CreObligationKind, string>;

export const CRE_GUARDRAIL =
  'Diligence support, not an appraisal: Pactlab reconciles the rent roll to the leases, recoveries to the lease terms and the statements, and condition reports to the capex schedule. It never values the property or opines on market rent, and it is not legal or engineering advice.';
export const CRE_NO_INVENTED_FIGURES =
  'Every figure comes from an import (the rent roll, the CAM reconciliation, the capex schedule, the P&L) or a sentence quoted from a lease or report; what none of them states is shown as missing, never filled in.';
