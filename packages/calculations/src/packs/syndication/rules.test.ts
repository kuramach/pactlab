import { describe, expect, it } from 'vitest';
import { D } from '../../metrics/decimal';
import { runWaterfall } from '../../syndication/waterfall';
import type { PackRuleEvidence } from '../rule-types';
import { offeringChecks, SYNDICATION_TRACK_RECORD_THIN, waterfallTermsFrom, type OfferingCheckItem } from './rules';

let seq = 0;
const item = (kind: string, source: OfferingCheckItem['source'], value: string | null, extra: Partial<OfferingCheckItem> = {}): OfferingCheckItem => ({
  id: `item-${(seq += 1)}`,
  kind,
  source,
  label: null,
  value,
  hurdle: null,
  documentId: `doc-${source}`,
  pageNumber: 2,
  quote: `${kind} ${value ?? ''} quoted`,
  ...extra,
});
const deal = (name: string, actual: string | null): PackRuleEvidence => ({
  id: `ev-${name}`,
  evidenceType: 'syndication.prior_deal',
  sourceRecordId: name,
  canonical: { deal: name, status: 'realized', actual_irr_pct: actual, actual_multiple: null },
});

const oaTerms = [
  item('ACQUISITION_FEE', 'OPERATING_AGREEMENT', '2'),
  item('ASSET_MANAGEMENT_FEE', 'OPERATING_AGREEMENT', '2'),
  item('DISPOSITION_FEE', 'OPERATING_AGREEMENT', '1'),
  item('OTHER_FEE', 'OPERATING_AGREEMENT', '1', { label: 'Loan guarantee fee' }),
  item('PREFERRED_RETURN', 'OPERATING_AGREEMENT', '8'),
  item('PROMOTE_TIER', 'OPERATING_AGREEMENT', '30', { hurdle: '15' }),
  item('PROMOTE_TIER', 'OPERATING_AGREEMENT', '40'),
];
const ppmTerms = [
  item('ACQUISITION_FEE', 'PPM', '2'),
  item('ASSET_MANAGEMENT_FEE', 'PPM', '2'),
  item('DISPOSITION_FEE', 'PPM', '1'),
  item('PREFERRED_RETURN', 'PPM', '8'),
  item('PROMOTE_TIER', 'PPM', '30', { hurdle: '15' }),
  item('PROMOTE_TIER', 'PPM', '40'),
];

function base() {
  const { terms } = waterfallTermsFrom(oaTerms);
  return runWaterfall(terms!, {
    purchasePrice: new D(1000), loanAmount: new D(600), interestRate: new D('0.05'), equity: new D(430), holdYears: 5,
    noiYear1: new D(60), noiGrowth: new D('0.03'), exitCapRate: new D('0.06'), sellingCosts: new D('0.02'),
  });
}

describe('syndication offering checks (T-106)', () => {
  it('reads the waterfall terms from the operating agreement, never the PPM', () => {
    const { terms, missing } = waterfallTermsFrom([...oaTerms, item('PREFERRED_RETURN', 'PPM', '10')]);
    expect(missing).toEqual([]);
    expect(terms!.prefRate.toString()).toBe('0.08');
    expect(terms!.tiers.map((tier) => [tier.hurdle?.toString() ?? null, tier.gpShare.toString()])).toEqual([['0.15', '0.3'], [null, '0.4']]);
    expect(waterfallTermsFrom(ppmTerms).missing).toEqual(['the preferred return', 'a final promote split with no hurdle']);
    expect(waterfallTermsFrom([...oaTerms, item('CATCH_UP', 'OPERATING_AGREEMENT', '50')]).unmodelled).toEqual(['a sponsor catch-up']);
  });

  it('(a) contradicts a stated IRR more than a point from the recomputed one, and verifies one within', () => {
    const result = base();
    const recomputed = new D(result.limitedPartners.irr!);
    const far = item('PROJECTED_IRR', 'PPM', recomputed.plus(4).toFixed(2));
    const near = item('EQUITY_MULTIPLE', 'PPM', result.limitedPartners.equityMultiple);
    const { proposals, claims } = offeringChecks({ items: [...oaTerms, ...ppmTerms, far, near], base: result, baseUnavailable: null, evidence: [] });
    expect(proposals.map((p) => p.key)).toEqual(['projected_irr:PPM', 'fee-missing:OTHER:loan guarantee fee']);
    expect(claims.find((claim) => claim.itemId === far.id)).toMatchObject({ status: 'CONTRADICTED', proposalKey: 'projected_irr:PPM' });
    expect(claims.find((claim) => claim.itemId === near.id)).toMatchObject({ status: 'VERIFIED', proposalKey: null });
  });

  it('(b) leaves a track-record claim with no actuals unverified, as a gap finding', () => {
    const claims = [
      item('TRACK_RECORD', 'DECK', '21.4', { label: 'Cedar Hollow Apartments' }),
      item('TRACK_RECORD', 'DECK', '19.2', { label: 'Stonebridge Flats' }),
      item('TRACK_RECORD', 'DECK', '18', { label: 'Never Listed Court' }),
    ];
    const evidence = [deal('Cedar Hollow Apartments (synthetic)', '21.0'), deal('Stonebridge Flats (synthetic)', null)];
    const result = offeringChecks({ items: claims, base: null, baseUnavailable: 'no terms', evidence });
    expect(result.claims.map((claim) => claim.status)).toEqual(['VERIFIED', 'UNVERIFIED', 'UNVERIFIED']);
    expect(result.proposals.map((p) => p.key)).toEqual(['track-record:stonebridge flats', 'track-record:never listed court']);
    expect(result.proposals[0]!.evidenceIds).toEqual(['ev-Stonebridge Flats (synthetic)']);
    expect(result.proposals.every((p) => p.direction === 0 && p.directionRationale)).toBe(true);
  });

  it('(c) flags a fee in the operating agreement the PPM does not list, and a fee the PPM states differently', () => {
    const ppm = ppmTerms.map((term) => (term.kind === 'DISPOSITION_FEE' ? { ...term, value: '0.5' } : term));
    const { proposals } = offeringChecks({ items: [...oaTerms, ...ppm], base: null, baseUnavailable: null, evidence: [] });
    expect(proposals.map((p) => p.key).sort()).toEqual(['fee-mismatch:DISPOSITION_FEE', 'fee-missing:OTHER:loan guarantee fee']);
    expect(proposals.find((p) => p.key.startsWith('fee-missing'))!.quotes).toHaveLength(1);
  });

  it('flags a PPM waterfall description that differs from the operating agreement', () => {
    const ppm = [...ppmTerms.filter((term) => term.kind !== 'PROMOTE_TIER' && term.kind !== 'PREFERRED_RETURN'), item('PREFERRED_RETURN', 'PPM', '10'), item('PROMOTE_TIER', 'PPM', '20', { hurdle: '15' }), item('PROMOTE_TIER', 'PPM', '40')];
    const { proposals } = offeringChecks({ items: [...oaTerms, ...ppm], base: null, baseUnavailable: null, evidence: [] });
    expect(proposals.map((p) => p.key).sort()).toEqual(['fee-missing:OTHER:loan guarantee fee', 'pref-mismatch', 'split-mismatch']);
  });

  it('never verifies an assumption, and leaves returns unverified without a recompute', () => {
    const { claims, proposals } = offeringChecks({ items: [item('NOI_GROWTH', 'PPM', '3'), item('PROJECTED_IRR', 'PPM', '17')], base: null, baseUnavailable: 'The operating agreement has no preferred return confirmed.', evidence: [] });
    expect(proposals).toEqual([]);
    expect(claims.map((claim) => [claim.status, claim.rationale])).toEqual([
      ['UNVERIFIED', 'The operating agreement has no preferred return confirmed.'],
      ['UNVERIFIED', 'An assumption, not a fact: it is tested as a scenario input, never verified.'],
    ]);
  });
});

describe('thin track record rule (T-106)', () => {
  it('flags fewer than three deals with actuals, citing every row; absence stays absence', () => {
    const thin = SYNDICATION_TRACK_RECORD_THIN.detect({ evidence: [deal('A', '15'), deal('B', null)], pages: [] });
    expect(thin).toHaveLength(1);
    expect(thin[0]!.description).toMatch(/1 of 2 prior deals .* no actuals for B/);
    expect(thin[0]!.evidenceIds).toEqual(['ev-A', 'ev-B']);
    expect(SYNDICATION_TRACK_RECORD_THIN.detect({ evidence: [deal('A', '15'), deal('B', '12'), deal('C', '9')], pages: [] })).toEqual([]);
    expect(SYNDICATION_TRACK_RECORD_THIN.detect({ evidence: [], pages: [] })).toEqual([]);
  });
});
