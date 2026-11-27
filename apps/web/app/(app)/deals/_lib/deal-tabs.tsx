'use client';

import { sectionApplies, type CompanyType } from '@pactlab/domain';
import { TabNav } from '@pactlab/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A section of the deal workspace; where it applies is `DEAL_SECTION_RULES` in @pactlab/domain. */
export interface DealSection {
  readonly path: string;
  readonly label: string;
}

export interface DealGroup {
  readonly key: 'overview' | 'diligence' | 'valuation' | 'close';
  readonly label: string;
  readonly sections: readonly DealSection[];
}

/**
 * The deal workspace in four tabs (T-094 B13). Every page keeps its URL, so
 * deep links still land; each sits under one tab, at most two clicks from
 * anywhere in the deal. "Said vs observed" is reached from Findings, where
 * its verdicts now show on each finding (B7).
 */
export const DEAL_GROUPS: readonly DealGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    sections: [
      { path: '', label: 'Summary' },
      { path: '/bidders', label: 'Bidders' },
      { path: '/listing', label: 'Public page' },
      { path: '/screening', label: 'Screening' },
      { path: '/team', label: 'Team' },
      // Connected AI apps' suggestions, waiting for a person to decide (T-084b).
      { path: '/suggestions', label: 'Suggestions' },
    ],
  },
  {
    key: 'diligence',
    label: 'Diligence',
    sections: [
      { path: '/documents', label: 'Documents' },
      { path: '/findings', label: 'Findings' },
      { path: '/sources', label: 'Sources' },
      { path: '/evidence', label: 'Evidence' },
      { path: '/finances', label: 'Finances' },
      // The QoE work product (T-135): schedule, add-back register, working-capital peg.
      { path: '/qoe', label: 'Quality of earnings' },
      // A sponsor's offering (T-106): its terms and claims, the track record and the waterfall check.
      { path: '/syndication', label: 'Syndication' },
      // A music catalog (T-140): the works and rights register, royalty income and termination exposure.
      { path: '/catalog', label: 'Catalog' },
      // An energy package (T-142): plants and interests, production and reserves, decimals, leases and liabilities.
      { path: '/energy', label: 'Assets' },
      // A fintech target (T-159): volume and take rate recomputed, claims, loss rates, licences, compliance evidence and the P&L by year.
      { path: '/fintech', label: 'Payments' },
      // A healthcare services target (T-160): collections and payer mix, denials and days in AR, credentials, clinician concentration, payer contracts and the P&L by year.
      { path: '/healthcare', label: 'Practice' },
      // A few-site clinic (T-161): the owner-operator's share by service line, referral concentration and the clinic lease.
      { path: '/clinics', label: 'Clinic' },
      // A pharma or biotech target (T-163): pipeline claims against the registry, the patent estate against the hold, licence obligations, dependence and R&D burn.
      { path: '/pharma', label: 'Pipeline' },
      // An e-commerce or DTC brand (T-164): channel revenue, unit economics on a contribution basis, platform accounts, returns and stock age.
      { path: '/ecommerce', label: 'Channels' },
      // An IT or professional services firm (T-167): realization, fees by client and partner, WIP and debtor ageing, covenant cover and recurring revenue.
      { path: '/services', label: 'Practice' },
      // A telecom or media business (T-168): subscriber claims, the rights and carriage register, counterparty concentration and content cost against ARPU.
      { path: '/telecom', label: 'Subscribers' },
      // A pooled vehicle (T-141): round checks, vehicle economics, side letters, investor seats and the investor view.
      { path: '/spv', label: 'SPV' },
      { path: '/engineering', label: 'Engineering' },
      { path: '/regulatory', label: 'Regulatory' },
      { path: '/claims', label: 'Seller statements' },
      // The buyer organization's red lines, rated on this pact's evidence (T-179). Buyer-confidential.
      { path: '/criticals', label: 'Criticals' },
    ],
  },
  {
    key: 'valuation',
    label: 'Valuation',
    sections: [
      { path: '/raise', label: 'Raise' },
      { path: '/valuation', label: 'Scenarios and bridge' },
      { path: '/foresight', label: 'Foresight' },
      { path: '/terms', label: 'Proposed terms' },
      // The letter of intent from the agreed terms (T-119).
      { path: '/loi', label: 'Letter of intent' },
    ],
  },
  {
    key: 'close',
    label: 'Close',
    sections: [
      // The buyer's investment committee decides before signing (T-118); never the seller's.
      { path: '/ic', label: 'Investment committee' },
      // How the buyer funds the deal, shown to the seller as attested (T-117).
      { path: '/financing', label: 'Financing' },
      // Both sides sign the agreed terms and work the checklist here (T-107).
      { path: '/closing', label: 'Closing' },
      { path: '/post-close', label: 'Post-close' },
    ],
  },
];

/** Every section, flattened; kept for callers that only need the paths. */
export const DEAL_SECTIONS: readonly DealSection[] = DEAL_GROUPS.flatMap((group) => group.sections);

/** The section of a deal a path belongs to ('' for the overview). */
export function dealSection(dealId: string, pathname: string): string {
  const base = `/deals/${dealId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return DEAL_SECTIONS.find((section) => section.path !== '' && (rest === section.path || rest.startsWith(`${section.path}/`)))?.path ?? '';
}

/** The tab a section sits under. */
export function dealGroup(section: string): DealGroup {
  return DEAL_GROUPS.find((group) => group.sections.some((entry) => entry.path === section)) ?? (DEAL_GROUPS[0] as DealGroup);
}

/** Only the sections this pact needs (batch 2): the rule table in @pactlab/domain decides. */
const visible = (sections: readonly DealSection[], companyType: CompanyType | null, sellerLed = false) =>
  sections.filter((section) => sectionApplies(section.path, { companyType, initiatedBy: sellerLed ? 'SELLER' : 'BUYER' }));

/** Four tabs across the deal, and the open tab's sections beneath them; sub-pages keep their section highlighted. */
/** Sections only the pact's own side ever sees, not even as a tab name (T-118). */
const OWN_SIDE_ONLY = new Set(['/ic', '/criticals', '/suggestions', '/qoe', '/syndication', '/catalog', '/energy', '/fintech', '/healthcare', '/clinics', '/pharma', '/ecommerce', '/services', '/telecom', '/spv']);

export function DealTabs({
  dealId,
  companyType = null,
  sellerLed = false,
  counterparty = false,
  pendingSuggestions = null,
}: {
  dealId: string;
  companyType?: CompanyType | null;
  sellerLed?: boolean;
  counterparty?: boolean;
  /** Suggestions waiting; null hides the section (no app can connect, or not the caller's to decide). */
  pendingSuggestions?: number | null;
}) {
  const active = dealSection(dealId, usePathname());
  const group = dealGroup(active);
  const sections = visible(group.sections, companyType, sellerLed)
    .filter((section) => !counterparty || !OWN_SIDE_ONLY.has(section.path))
    .filter((section) => section.path !== '/suggestions' || pendingSuggestions !== null || active === '/suggestions')
    .map((section) => (section.path === '/suggestions' && pendingSuggestions ? { ...section, label: `Suggestions (${pendingSuggestions})` } : section));
  return (
    <div className="flex flex-col gap-3">
      <TabNav
        label="Deal sections"
        items={DEAL_GROUPS.map((entry) => ({
          href: `/deals/${dealId}${visible(entry.sections, companyType, sellerLed)[0]?.path ?? ''}`,
          label: entry.label,
          active: entry.key === group.key,
        }))}
      />
      {sections.length > 1 ? (
        <nav aria-label={`${group.label} sections`} className="flex flex-wrap gap-2 text-sm">
          {sections.map((section) => (
            <Link
              key={section.path}
              href={`/deals/${dealId}${section.path}`}
              aria-current={section.path === active ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${section.path === active ? 'border-primary bg-muted font-semibold' : 'border-border hover:bg-muted'}`}
            >
              {section.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
