import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEAL_SECTION_RULES, DEMO_DATA_COMMIT, packFor, type CompanyType } from '@pactlab/domain';

/**
 * Demo coverage (T-124): where each pact section's demo data lives, so a test can prove every
 * section a demo pact shows has something in it, and so a new section cannot ship without demo
 * data or a stated reason. Keyed by the section paths of `DEAL_SECTION_RULES`; a missing key fails.
 */
export type SectionProbe = { readonly table: string; readonly column?: string; readonly where?: string } | { readonly exempt: string };

export const DEMO_SECTION_COVERAGE: Readonly<Record<string, SectionProbe>> = {
  '': { table: 'deals', column: 'id' },
  '/bidders': { table: 'bids' },
  '/listing': { table: 'deal_listings' },
  '/screening': { table: 'screening_reviews' },
  '/team': { table: 'deal_memberships' },
  '/suggestions': { exempt: 'Suggestions come from AI apps a customer connects over MCP; demo organizations have MCP off, so the tab is hidden there.' },
  '/documents': { table: 'documents' },
  '/findings': { table: 'findings' },
  '/sources': { table: 'sync_runs' },
  '/evidence': { table: 'evidence_items' },
  '/finances': { table: 'balance_sheet_items' },
  // Follow-up: seed cited QoE entries once the pinned demo-data repository carries an income statement and monthly balance sheets to quote.
  '/qoe': { exempt: 'Quality of earnings (T-135) is new; the demo pacts have no cited income statement or monthly balance sheets to quote yet, so the tab shows how to start.' },
  '/engineering': { table: 'connections', where: `provider IN ('github', 'jira')` },
  '/regulatory': { table: 'regulatory_entries' },
  '/claims': { table: 'deal_claims' },
  '/raise': { table: 'venture_offers' },
  '/syndication': { table: 'syndication_offering_items' },
  '/valuation': { table: 'valuation_scenarios' },
  '/foresight': { exempt: 'Prepared from published forecasts the first time the tab is opened, so it is never stale in a demo.' },
  '/terms': { table: 'term_proposal_batches' },
  '/loi': { table: 'loi_versions' },
  '/ic': { table: 'ic_submissions' },
  '/financing': { table: 'financing_plans' },
  '/closing': { table: 'closing_items' },
  '/post-close': { table: 'post_close_items' },
};

/**
 * Sections a group of demo pacts shows but leaves empty on purpose (a tab that could never have data is
 * hidden by `DEAL_SECTION_RULES` instead; these are tabs that can fill up later, just not in the demo), keyed `<section>@<TYPE>/<BUYER|SELLER>`,
 * each with its reason. Kept short and reviewed: an entry here is a tab a prospect will see empty.
 */
const TEASER = 'The seller-led demo shows the sale process (public page, bidders, offers, their financing); diligence content lives on the buyer-led demo pacts.';
export const DEMO_COVERAGE_EXCEPTIONS: Readonly<Record<string, string>> = {
  '/screening@MULTIFAMILY/SELLER': TEASER,
  '/documents@MULTIFAMILY/SELLER': TEASER,
  '/findings@MULTIFAMILY/SELLER': TEASER,
  '/sources@MULTIFAMILY/SELLER': TEASER,
  '/evidence@MULTIFAMILY/SELLER': TEASER,
  '/finances@MULTIFAMILY/SELLER': TEASER,
  '/regulatory@MULTIFAMILY/SELLER': TEASER,
  '/claims@MULTIFAMILY/SELLER': TEASER,
  '/valuation@MULTIFAMILY/SELLER': TEASER,
  '/post-close@MULTIFAMILY/SELLER': TEASER,
};

/**
 * The demo build version: a hash of what decides what a demo contains. The builders' source, the pinned synthetic data,
 * the section list and each pack's import targets. A deploy that changes any of them makes every
 * demo built before it stale, and the sweep rebuilds them (idle ones at once, shared ones when their share ends).
 */
export function demoBuildVersion(types: readonly CompanyType[]): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const hash = createHash('sha256');
  for (const file of ['demo-org.ts', 'demo-enrich.ts', 'demo-coverage.ts']) hash.update(readFileSync(join(here, file)));
  hash.update(DEMO_DATA_COMMIT);
  hash.update(JSON.stringify(Object.keys(DEAL_SECTION_RULES).sort()));
  hash.update(JSON.stringify([...types].sort().map((type) => [type, [...packFor(type).importTargets].sort()])));
  return hash.digest('hex').slice(0, 16);
}
