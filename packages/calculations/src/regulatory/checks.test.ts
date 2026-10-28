import { describe, expect, it } from 'vitest';
import {
  buyerViability,
  certaintyStatus,
  cherryPick,
  coherence,
  gradeCommitment,
  headroom,
  laborExposure,
  localConcentration,
  overlapPockets,
  unaddressedFeedback,
  unverifiablePledges,
} from './checks';
import type { DealCertaintyTerms, RemedyPackage, Site } from './types';

let next = 0;
function site(party: Site['party'], market: string, sales: string, extra: Partial<Site> = {}): Site {
  next += 1;
  return {
    siteId: `S${next}`,
    party,
    firm: party === 'RIVAL' ? 'Rival' : party,
    market,
    region: 'North',
    banner: party,
    fullService: true,
    sales,
    performance: '0.05',
    unionized: false,
    cbaId: null,
    distributionCenter: `DC-${party}`,
    systems: `SYS-${party}`,
    ...extra,
  };
}

const terms: DealCertaintyTerms = {
  signedOn: '2024-01-01',
  outsideDate: '2025-01-01',
  effortsStandard: 'REASONABLE_BEST_EFFORTS',
  divestitureCap: 100,
  currency: 'USD',
  terminationFees: [{ payer: 'ACQUIRER', amount: '50000000', trigger: 'no clearance' }],
  sources: { divestitureCap: '§6.3(b)' },
};
const remedy = (siteIds: string[], extra: Partial<RemedyPackage> = {}): RemedyPackage => ({
  id: 'r',
  revision: 1,
  date: '2024-06-01',
  siteIds,
  distributionCenters: [],
  systemsTransferred: [],
  buyer: 'B',
  ...extra,
});

describe('local concentration (2023 Merger Guidelines presumption)', () => {
  it('computes HHI before and after and flags a presumed market', () => {
    // 40/30/30 → merged 70/30: HHI 3400 → 5800, Δ2400.
    const sites = [site('ACQUIRER', 'M1', '40'), site('TARGET', 'M1', '30'), site('RIVAL', 'M1', '30')];
    expect(localConcentration(sites)).toEqual([
      { market: 'M1', hhiBefore: 3400, hhiAfter: 5800, delta: 2400, mergedShare: '0.7', firmsBefore: 3, firmsAfter: 2, presumed: true },
    ]);
  });

  it('does not presume a market where the change is 100 or less', () => {
    // 10/5/85 → Δ = 2·10·5 = 100: not more than 100.
    const sites = [site('ACQUIRER', 'M2', '10'), site('TARGET', 'M2', '5'), site('RIVAL', 'M2', '85')];
    expect(localConcentration(sites)[0]).toMatchObject({ delta: 100, presumed: false });
    expect(overlapPockets(sites)).toEqual([]);
  });

  it('ignores markets where only one party is present, and non-full-service sites', () => {
    const sites = [site('ACQUIRER', 'M3', '50'), site('RIVAL', 'M3', '50'), site('TARGET', 'M3', '50', { fullService: false })];
    expect(localConcentration(sites)).toEqual([]);
  });

  it('names markets where the pair are the only full-service competitors', () => {
    const sites = [site('ACQUIRER', 'Solo', '50'), site('TARGET', 'Solo', '50')];
    expect(overlapPockets(sites)[0]).toMatchObject({ phase: 'PRE', severity: 'CRITICAL', inputs: { onlyFullServiceCompetitors: ['Solo'] } });
  });
});

describe('labor exposure', () => {
  const unionized = (party: Site['party'], market: string) => site(party, market, '50', { unionized: true, cbaId: 'Local 1' });
  it('needs high density and a shared agreement in enough markets', () => {
    const markets = ['A', 'B', 'C'];
    const exposed = markets.flatMap((market) => [unionized('ACQUIRER', market), unionized('TARGET', market)]);
    expect(laborExposure(exposed)[0]).toMatchObject({ phase: 'PRE', inputs: { markets } });
    expect(laborExposure(exposed, { minMarkets: 4 })).toEqual([]);
    const separate = markets.flatMap((market) => [unionized('ACQUIRER', market), site('TARGET', market, '50', { unionized: true, cbaId: 'Local 2' })]);
    expect(laborExposure(separate)).toEqual([]);
  });
});

describe('remedy workbench', () => {
  it('headroom: flags unused cap above 5%, not a package at the cap', () => {
    const ninety = Array.from({ length: 90 }, (_, i) => `S${i}`);
    expect(headroom(terms, remedy(ninety))[0]).toMatchObject({ inputs: { cap: 100, offered: 90, unused: 10 }, severity: 'HIGH' });
    expect(headroom(terms, remedy(Array.from({ length: 97 }, (_, i) => `S${i}`)))).toEqual([]);
  });

  it('cherry-pick: compares divested and kept sites in the same markets by median', () => {
    const kept = [site('ACQUIRER', 'X', '1', { performance: '0.10' }), site('ACQUIRER', 'X', '1', { performance: '0.10' })];
    const weak = [site('TARGET', 'X', '1', { performance: '0.07' }), site('TARGET', 'X', '1', { performance: '0.07' })];
    expect(cherryPick([...kept, ...weak], remedy(weak.map((s) => s.siteId)))[0]?.inputs).toMatchObject({ divestedMedian: '0.07', keptMedian: '0.1' });
    const even = [site('TARGET', 'Y', '1', { performance: '0.095' })];
    const keptY = [site('ACQUIRER', 'Y', '1', { performance: '0.10' })];
    expect(cherryPick([...even, ...keptY], remedy(even.map((s) => s.siteId)))).toEqual([]);
  });

  it('coherence: a single banner with its distribution and systems scores 100', () => {
    const sold = [site('TARGET', 'Z', '1'), site('TARGET', 'Z', '1')];
    expect(coherence(sold, remedy(sold.map((s) => s.siteId), { distributionCenters: ['DC-TARGET'], systemsTransferred: ['SYS-TARGET'] })).score).toBe(100);
    const mixed = [site('TARGET', 'Z', '1'), site('ACQUIRER', 'Z', '1')];
    const scored = coherence(mixed, remedy(mixed.map((s) => s.siteId)));
    expect(scored).toMatchObject({ banners: 2, distributionCovered: '0', patchworkRegions: ['North'] });
    expect(scored.score).toBeLessThan(60);
  });

  it('buyer viability: scale and precedent', () => {
    const big = { name: 'B', retailSitesOperated: 500, yearsOperatingRetail: 20, precedents: [] };
    expect(buyerViability(big, remedy(['a', 'b']))).toEqual([]);
    expect(buyerViability({ ...big, retailSitesOperated: 10 }, remedy(Array.from({ length: 100 }, (_, i) => `S${i}`)))[0]?.severity).toBe('HIGH');
    expect(buyerViability({ ...big, precedents: [{ year: 2015, note: 'n', source: 's' }] }, remedy(['a']))[0]).toBeDefined();
  });

  it('feedback: only criticism no later revision addresses stays open, with its age', () => {
    const rounds = [
      { round: 1, date: '2024-01-01', regulator: 'R', criticisms: [{ topic: 'SIZE', substance: 'too small' }] },
      { round: 2, date: '2024-03-01', regulator: 'R', criticisms: [{ topic: 'COHERENCE', substance: 'patchwork' }] },
    ];
    const revisions = [{ revision: 2, date: '2024-02-01', addresses: ['SIZE'] }];
    const open = unaddressedFeedback(rounds, revisions, '2024-06-29');
    expect(open.map((finding) => finding.inputs)).toEqual([{ round: 2, topic: 'COHERENCE', raisedOn: '2024-03-01', revisionsSince: 0, daysOpen: 120 }]);
    // A revision dated before the round cannot answer it.
    expect(unaddressedFeedback(rounds, [{ revision: 2, date: '2024-02-01', addresses: ['SIZE', 'COHERENCE'] }], '2024-06-29')).toHaveLength(1);
  });
});

describe('covenants and commitments', () => {
  it('counts elapsed time, the long-stop and fee exposure from the agreement', () => {
    expect(certaintyStatus(terms, '2024-07-01')).toEqual({ elapsedDays: 182, daysToOutsideDate: 184, feeExposure: { ACQUIRER: '50000000', TARGET: '0' } });
  });

  it('grades pledges by measurement, enforcement and term', () => {
    const base = { id: 'p', text: 'Lower prices' };
    expect(gradeCommitment({ ...base, measurement: 'basket index', enforcementParty: 'state AG', durationMonths: 36 })).toBe('VERIFIABLE');
    expect(gradeCommitment({ ...base, measurement: 'basket index', enforcementParty: null, durationMonths: null })).toBe('PARTIAL');
    expect(gradeCommitment({ ...base, measurement: null, enforcementParty: null, durationMonths: 24 })).toBe('UNVERIFIABLE');
    expect(unverifiablePledges([{ ...base, measurement: null, enforcementParty: null, durationMonths: null }])).toHaveLength(1);
  });
});
