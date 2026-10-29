import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquirerFeeExposure, afterDivestiture, buildScenario, comparePackages, divestedEarnings, remedyCost, residualPresumed } from './compare';
import type { DealCertaintyTerms, RemedyBuyer, RemedyPackage, Site } from './types';

const site = (siteId: string, party: Site['party'], market: string, sales: string, extra: Partial<Site> = {}): Site => ({
  siteId,
  party,
  firm: party === 'RIVAL' ? 'Rival' : party,
  market,
  region: 'R1',
  banner: party,
  fullService: true,
  sales,
  performance: '0.05',
  unionized: false,
  cbaId: null,
  distributionCenter: `DC-${party}`,
  systems: `SYS-${party}`,
  ...extra,
});
const remedy = (siteIds: string[]): RemedyPackage => ({ id: 'p', revision: 1, date: '', siteIds, distributionCenters: [], systemsTransferred: [], buyer: 'Buyer Co' });

describe('package comparison (T-091 scenario builder)', () => {
  // Market M: the pair hold 80% — presumed. Divesting the target's store to a new rival resolves it.
  const sites = [site('a1', 'ACQUIRER', 'M', '400'), site('t1', 'TARGET', 'M', '400'), site('r1', 'RIVAL', 'M', '200'), site('a2', 'ACQUIRER', 'N', '100'), site('r2', 'RIVAL', 'N', '900')];

  it('re-runs the presumption with the divested sites in the remedy buyer’s hands', () => {
    expect(residualPresumed(sites, remedy([]))).toEqual(['M']);
    expect(residualPresumed(sites, remedy(['t1']))).toEqual([]);
    expect(afterDivestiture(sites, remedy(['t1'])).find((s) => s.siteId === 't1')).toMatchObject({ party: 'RIVAL', firm: 'Buyer Co' });
  });

  it('prices the remedy in decimals, never floats', () => {
    const big = [site('x', 'TARGET', 'M', '123456789.01', { performance: '0.0731' })];
    expect(divestedEarnings(big, remedy(['x']))).toBe('9024691');
    expect(remedyCost(big, remedy(['x']), '7.5')).toBe('67685185');
    const terms = { terminationFees: [{ payer: 'ACQUIRER', amount: '600000000', trigger: '' }, { payer: 'ACQUIRER', amount: '25000000', trigger: '' }, { payer: 'TARGET', amount: '900000000', trigger: '' }] } as unknown as DealCertaintyTerms;
    expect(acquirerFeeExposure(terms)).toBe('600000000');
  });

  it('builds an explicit site list from markets, adds and removals — merging-party, full-service sites only', () => {
    const built = buildScenario({ sites, id: 's', base: remedy(['a2']), buyer: 'Buyer Co', addMarkets: ['M'], divestingParty: 'TARGET', addSites: ['r1', 'zz'], removeSites: ['a2'], transferOperations: true });
    expect(built.remedy.siteIds).toEqual(['t1']);
    expect(built.remedy.distributionCenters).toEqual(['DC-TARGET']);
    expect(built.unknownSites).toEqual(['zz']);
  });

  it('flags a package beyond the cap', () => {
    const terms = { divestitureCap: 1, terminationFees: [], sources: {} } as unknown as DealCertaintyTerms;
    const [row] = comparePackages({ sites, terms, candidates: [{ label: 'two', remedy: remedy(['t1', 'a2']) }] });
    expect(row?.defects.map((d) => d.check)).toContain('over-cap');
    expect(row?.unusedHeadroom).toBe(-1);
  });
});

describe('Case 1: the revision the parties offered, against a scenario that closes the overlaps', () => {
  const CASE = resolve(import.meta.dirname, '../../../../demo-data/cases/case-01-grocery');
  const read = (file: string) => readFileSync(join(CASE, file), 'utf8');
  const [head = '', ...lines] = read('sites.csv').trim().split('\n');
  const header = head.split(',');
  const all: Site[] = lines.map((line) => {
    const cells = line.split(',');
    const cell = (column: string) => cells[header.indexOf(column)] ?? '';
    return { siteId: cell('site_id'), party: cell('party') as Site['party'], firm: cell('firm'), market: cell('market'), region: cell('region'), banner: cell('banner'), fullService: cell('full_service') === 'yes', sales: cell('sales'), performance: cell('performance'), unionized: cell('unionized') === 'yes', cbaId: cell('cba_id') || null, distributionCenter: cell('distribution_center'), systems: cell('systems') };
  });
  const offered = JSON.parse(read('package.json')) as RemedyPackage;
  const terms = JSON.parse(read('terms.json')) as DealCertaintyTerms;
  const buyer = JSON.parse(read('buyer.json')) as RemedyBuyer;

  it('shows revision 3 leaves most presumed markets standing, and what closing them costs', () => {
    const residual = residualPresumed(all, offered);
    const fill = buildScenario({ sites: all, id: 'fill', base: offered, buyer: offered.buyer, addMarkets: residual, divestingParty: 'TARGET', addSites: [], removeSites: [], transferOperations: true });
    const [rev3, closing] = comparePackages({ sites: all, terms, buyer, multiple: '7', candidates: [{ label: 'Revision 3', remedy: offered }, { label: 'Close the overlaps', remedy: fill.remedy }] });
    expect(rev3).toMatchObject({ sites: 579, presumedBefore: 78, unusedHeadroom: 71, verdict: 'LEAVES_OVERLAP' });
    expect(rev3?.residualPresumed.length).toBe(66);
    expect(closing?.residualPresumed).toEqual([]);
    expect(closing?.verdict).toBe('RESOLVES_WITH_DEFECTS');
    expect(closing?.defects.map((d) => d.check)).toEqual(['over-cap', 'buyer-viability']);
    expect(closing?.coherence.score).toBeGreaterThan(rev3?.coherence.score ?? 100);
  });
});
