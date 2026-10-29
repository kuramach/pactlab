import type { PackId } from '../packs/registry';

/**
 * Regulator registry (T-091 Part 5). For each pack: the authorities that can
 * block or condition a deal and the theory of harm each runs, and how deep the
 * screen goes. It is a checklist with evidence slots for the analyst — never a
 * prediction, and not legal advice.
 */
export interface Authority {
  readonly name: string;
  readonly scope: string;
  readonly theoryOfHarm: string;
}

export interface RegulatoryProfile {
  /** FULL runs the local-market, remedy and covenant machinery; LIGHT shows the checklist and covenants only. */
  readonly depth: 'FULL' | 'LIGHT';
  readonly authorities: readonly Authority[];
}

const ANTITRUST: readonly Authority[] = [
  { name: 'Federal antitrust agencies (FTC / DOJ Antitrust Division)', scope: 'Merger review under the HSR Act and Clayton Act §7', theoryOfHarm: 'Lessened competition in relevant local or national markets; labor-market effects' },
  { name: 'State attorneys general', scope: 'State and federal antitrust enforcement, alone or alongside the federal agencies', theoryOfHarm: 'Local-market concentration and price effects in the state' },
];

const extra = (...authorities: Authority[]) => [...ANTITRUST, ...authorities];

export const REGULATORY_PROFILES: Readonly<Record<PackId, RegulatoryProfile>> = {
  SOFTWARE_SAAS: { depth: 'FULL', authorities: ANTITRUST },
  FINTECH: {
    depth: 'FULL',
    authorities: extra(
      { name: 'Banking regulators (federal and state)', scope: 'Change-in-control approvals for chartered entities and bank partnerships', theoryOfHarm: 'Safety and soundness; consumer-protection posture' },
      { name: 'Consumer Financial Protection Bureau', scope: 'Supervision of consumer financial products', theoryOfHarm: 'Consumer harm in lending, payments or servicing' },
    ),
  },
  HEALTHCARE: { depth: 'FULL', authorities: extra({ name: 'State health departments', scope: 'Licensing and, where it applies, certificate-of-need review', theoryOfHarm: 'Access, cost and quality of care in the service area' }) },
  TELECOM_MEDIA: {
    depth: 'FULL',
    authorities: extra(
      { name: 'Federal Communications Commission', scope: 'Transfer of licenses; public-interest review', theoryOfHarm: 'Public interest, competition and service obligations' },
      { name: 'State public utility commissions', scope: 'Transfer approvals for regulated carriers', theoryOfHarm: 'Service quality and rates for subscribers in the state' },
    ),
  },
  PROFESSIONAL_SERVICES: { depth: 'FULL', authorities: ANTITRUST },
  PHARMA_BIOTECH: {
    depth: 'FULL',
    authorities: extra({ name: 'Food and Drug Administration', scope: 'Transfer of applications and approvals; manufacturing compliance', theoryOfHarm: 'Not a merger authority; its posture affects pipeline value and timing' }),
  },
  ECOMMERCE_DTC: { depth: 'FULL', authorities: ANTITRUST },
  MULTIFAMILY: { depth: 'FULL', authorities: extra({ name: 'Local land-use and housing authorities', scope: 'Zoning, rent regulation and affordability covenants', theoryOfHarm: 'Covenant compliance and tenant protections' }) },
  COMMERCIAL_PROPERTY: { depth: 'FULL', authorities: extra({ name: 'Local land-use authorities', scope: 'Zoning and permitted use', theoryOfHarm: 'Use restrictions on the properties' }) },
  HOTELS: { depth: 'FULL', authorities: extra({ name: 'Franchisors (brand consent)', scope: 'Consent to change of ownership under franchise agreements', theoryOfHarm: 'Not a regulator: a contractual consent that can condition or block the transfer' }) },
  SMALL_CLINICS: { depth: 'FULL', authorities: extra({ name: 'State health departments', scope: 'Licensing and, where it applies, certificate-of-need review', theoryOfHarm: 'Access, cost and quality of care in the service area' }) },
  HOSPITALS: {
    depth: 'FULL',
    authorities: extra(
      { name: 'State health departments', scope: 'Licensing, certificate-of-need and transaction notice laws', theoryOfHarm: 'Access, cost and quality of care; local hospital-market concentration and payer bargaining' },
      { name: 'Centers for Medicare & Medicaid Services', scope: 'Change of ownership for provider agreements', theoryOfHarm: 'Continuity of participation and billing' },
    ),
  },
  // A seed round has no merger review: the light screen keeps the checklist and the covenant tracker only.
  VENTURE_RAISE: { depth: 'LIGHT', authorities: [{ name: 'Securities regulators', scope: 'Exempt-offering rules for the round', theoryOfHarm: 'Investor eligibility and disclosure' }] },
};

export function regulatoryProfile(pack: PackId): RegulatoryProfile {
  return REGULATORY_PROFILES[pack];
}
