import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import {
  agreementObligations,
  holdWindow,
  keyScientists,
  manufacturingDependence,
  obligationChecks,
  patentEstate,
  periodEnd,
  phaseLabel,
  phaseRank,
  pipelineClaims,
  productCliffs,
  rdBurn,
  timelineAccelerations,
  triggerSignature,
} from './pipeline';
import { PHARMA_BURN_VS_TIMELINE, PHARMA_KEY_SCIENTIST, PHARMA_OBLIGATIONS, PHARMA_PATENT_CLIFF, PHARMA_PIPELINE_CLAIMS } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const programme = (code: string, phase: string, next: string, expected: string) => row('pharma.programme', code, { programme: code, indication: 'Indication', phase, next_milestone: next, expected });
const trial = (id: string, code: string, phase: string, status: string, primary = '') => row('pharma.registry_trial', id, { registry_id: id, programme: code, phase, status, start_date: '2025-01-15', primary_completion: primary });
const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });

describe('pharma pipeline model (T-163)', () => {
  it('ranks phases, combined phases between their parts, and reads periods', () => {
    expect([phaseRank('Preclinical'), phaseRank('Phase 1'), phaseRank('Phase I/II'), phaseRank('Phase 2'), phaseRank('Phase 2/3'), phaseRank('Phase III'), phaseRank('IND-enabling')]).toEqual([0, 2, 3, 4, 5, 6, null]);
    expect([phaseLabel(3), phaseLabel(6)]).toEqual(['Phase 1/2', 'Phase 3']);
    expect([periodEnd('2027-Q2'), periodEnd('Q4 2027'), periodEnd('2027-08'), periodEnd('2027'), periodEnd('soon')]).toEqual(['2027-06-30', '2027-12-31', '2027-08-31', '2027-12-31', null]);
  });

  it('checks each phase claim against the registry, else the correspondence, and says when nothing bears on it', () => {
    const evidence = [
      programme('PX-410', 'Phase 2', 'Phase 2 interim data', '2027-Q4'),
      programme('PX-210', 'Phase 3', 'Top-line data', '2027-Q2'),
      programme('PX-500', 'Phase 1', 'First patient dosed', '2026-Q4'),
      programme('PX-600', 'Phase 2', 'Phase 2 start', '2027-Q1'),
      trial('CT-0410-01', 'PX-410', 'Phase 1', 'recruiting', '2027-03-31'),
      trial('CT-0210-03', 'PX-210', 'Phase 3', 'active not recruiting', '2027-05-31'),
    ];
    const pages = [page('letter', 'Minutes of the Type C meeting with the FDA (synthetic). The Agency agreed that the Phase 1 data for PX-600 support dose selection.')];
    const claims = pipelineClaims(evidence, pages);
    const by = (code: string, aspect: string) => claims.find((claim) => claim.programme === code && claim.aspect === aspect);
    expect(by('PX-410', 'PHASE')).toMatchObject({ status: 'CONTRADICTED', rationale: expect.stringContaining('The latest phase registered is Phase 1: CT-0410-01 is registered as Phase 1 (recruiting)'), evidenceIds: ['PX-410', 'CT-0410-01'] });
    expect(by('PX-410', 'TIMELINE')).toMatchObject({ status: 'UNVERIFIED', rationale: 'No Phase 2 trial for PX-410 is registered, so no primary completion date bears on the readout.' });
    expect(by('PX-210', 'PHASE')?.status).toBe('VERIFIED');
    expect(by('PX-210', 'TIMELINE')).toMatchObject({ status: 'VERIFIED', rationale: "CT-0210-03's registered primary completion is 2027-05-31, within 2027-Q2 (by 2027-06-30)." });
    // Correspondence stands in when no trial is registered; it names Phase 1, below the claimed Phase 2.
    expect(by('PX-600', 'PHASE')).toMatchObject({ status: 'CONTRADICTED', quotes: [expect.objectContaining({ documentId: 'letter' })] });
    expect(by('PX-500', 'PHASE')).toMatchObject({ status: 'UNVERIFIED' });
    // Only data readouts carry a timeline claim.
    expect(by('PX-500', 'TIMELINE')).toBeUndefined();
    // A readout after the quarter claimed, and a programme whose every trial stopped.
    const late = pipelineClaims([programme('PX-210', 'Phase 3', 'Top-line data', '2027-Q1'), trial('CT-0210-03', 'PX-210', 'Phase 3', 'terminated', '2027-05-31')], []);
    expect(late.map((claim) => `${claim.aspect}:${claim.status}`)).toEqual(['PHASE:VERIFIED', 'TIMELINE:CONTRADICTED', 'STATUS:CONTRADICTED']);
    // The deck's own words never verify a claim: only correspondence or registry documents count.
    expect(pipelineClaims([programme('PX-500', 'Phase 2', '', '')], [page('deck', 'Investor presentation (synthetic). PX-500 is in Phase 2.')])[0]?.status).toBe('UNVERIFIED');
  });

  it('reads the patent estate, a patent record governing, and prices a cliff inside the hold on the product’s billed revenue', () => {
    const patent = (family: string, product: string, jurisdiction: string, type: string, expiry: string) => row('pharma.patent', `${family}-${jurisdiction}`, { family, product, jurisdiction, type, expiry });
    const line = (id: string, name: string, month: string, amount: string) => row('billing.invoice_line', id, { customer_name: name, amount, currency: 'USD', period_start: `${month}-01` });
    const evidence = [
      patent('PF-01', 'Product A', 'US', 'composition of matter', '2028-09-30'),
      patent('PF-01', 'Product A', 'EP', 'composition of matter', '2028-06-30'),
      patent('PF-02', 'Product A', 'US', 'formulation', '2033-11-30'),
      patent('PF-03', 'Product B', 'US', 'method of use', '2033-08-31'),
      ...Array.from({ length: 12 }, (_, index) => line(`a${index}`, 'Partner — royalties on Product A (synthetic)', `2026-${String(index + 1).padStart(2, '0')}`, '100000.00')),
      line('b', 'Partner — royalties on Product B (synthetic)', '2026-12', '5000.00'),
    ];
    const pages = [
      page('cert', 'Patent record (synthetic). Patent family PF-01 (US) is in force and expires on 31 March 2028.'),
      page('memo', 'Information memorandum (synthetic). The target closing date is 30 September 2026. The buyer assumes a hold period of 5 years.'),
    ];
    const estate = patentEstate(evidence, pages);
    expect(estate.find((entry) => entry.family === 'PF-01' && entry.jurisdiction === 'US')).toMatchObject({ scheduleExpiry: '2028-09-30', expiry: '2028-03-31', basis: 'DOCUMENT' });
    const hold = holdWindow(evidence, pages);
    expect(hold).toMatchObject({ from: '2026-09-30', basis: 'EXPECTED_CLOSING', years: 5, yearsStated: true, to: '2031-09-30' });
    const [a, b] = productCliffs(estate, hold, evidence);
    expect(a).toMatchObject({ product: 'Product A', cliff: '2028-03-31', jurisdiction: 'US', state: 'IN_HOLD', monthsAfterClosing: 18 });
    expect(a?.yearsOfHoldAfter?.toFixed(2)).toBe('3.50');
    expect(a?.revenue?.annual.toFixed(2)).toBe('1200000.00');
    expect(b).toMatchObject({ product: 'Product B', state: 'AFTER_HOLD' });
    const [found, ...rest] = PHARMA_PATENT_CLIFF.detect({ evidence, pages });
    expect(rest).toEqual([]);
    expect(found).toMatchObject({ title: 'Key patent expires 18 months after closing: Product A', direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '1200000.00', high: '4200000.00' } });
  });

  it('recomputes milestones, royalties and fees from the agreements and finds what the seller’s model leaves out', () => {
    const agreement = page(
      'licence',
      'Licence agreement between Calvera and Brennick Biologics (synthetic). Calvera shall pay Brennick Biologics a milestone payment of USD 12,000,000 upon the first dosing of a patient in a Phase 2 trial of PX-330. ' +
        'Calvera shall pay Brennick Biologics a milestone payment of USD 25,000,000 upon the start of the first Phase 3 trial of PX-330. Calvera shall pay Brennick Biologics a royalty of 6% of net sales of licensed products. Calvera shall pay Brennick Biologics an annual licence fee of USD 250,000.',
    );
    expect(agreementObligations([agreement, { ...agreement, documentId: 'copy' }]).map((entry) => entry.kind)).toEqual(['milestone', 'milestone', 'royalty', 'licence_fee']);
    expect(triggerSignature('the first dosing of a patient in a Phase 2 trial of PX-330')).toBe('START|4|PX-330');
    const model = (id: string, kind: string, trigger: string, amount: string, rate = '') => row('pharma.obligation', id, { obligation_id: id, counterparty: 'Brennick Biologics', kind, trigger, amount, rate, expected: '' });
    const evidence = [
      programme('PX-330', 'Phase 1', 'Phase 2 start', '2027-Q3'),
      model('OB-1', 'milestone', 'Phase 3 start (PX-330)', '20000000.00'),
      model('OB-2', 'royalty', 'Net sales', '', '0.05'),
      model('OB-3', 'licence_fee', '', '250000.00'),
    ];
    const { checks } = obligationChecks(evidence, [agreement]);
    expect(checks.map((check) => check.state)).toEqual(['OMITTED', 'UNDERSTATED', 'RATE_UNDERSTATED', 'IN_MODEL']);
    expect(checks[0]?.expected).toMatchObject({ programme: 'PX-330', expected: '2027-Q3' });
    expect(checks[1]?.gap?.toFixed(2)).toBe('5000000.00');
    const proposals = PHARMA_OBLIGATIONS.detect({ evidence, pages: [agreement] });
    expect(proposals.map((proposal) => proposal.title)).toEqual([
      "Milestone payment omitted from the seller's model: Brennick Biologics",
      "Milestone payment understated in the seller's model: Brennick Biologics",
      "Royalty rate understated in the seller's model: Brennick Biologics",
    ]);
    expect(proposals[0]).toMatchObject({ direction: -1, pricedRisk: { low: '12000000.00', high: '12000000.00', currency: 'USD' } });
    expect(proposals[0]?.description).toContain("The pipeline schedule expects PX-330's Phase 2 start in 2027-Q3.");
    // Without the seller's model there is nothing to check.
    expect(PHARMA_OBLIGATIONS.detect({ evidence: [], pages: [agreement] })).toEqual([]);
  });

  it('finds single-source manufacturing and key-scientist concentration, and a retention agreement clears it', () => {
    const supply = page('supply', 'Supply agreement (synthetic). Halvorsen Contract Manufacturing is the sole manufacturer of Product A. No second source has been qualified.');
    expect(manufacturingDependence([supply], ['Product A', 'Product B'])).toMatchObject([{ product: 'Product A', singleSource: true, secondSource: { inPlace: false } }]);
    expect(manufacturingDependence([page('s2', 'Supply agreement. Halvorsen is the sole manufacturer of Product A. A second manufacturing site at Dorrance was qualified in 2025.')], ['Product A'])[0]?.singleSource).toBe(false);
    const evidence = [
      programme('PX-1', 'Phase 1', '', ''),
      programme('PX-2', 'Phase 2', '', ''),
      row('pharma.patent', 'p1', { family: 'PF-01', product: 'A' }),
      row('pharma.patent', 'p2', { family: 'PF-02', product: 'A' }),
      row('pharma.scientist', 's1', { scientist_ref: 'S-01', function: 'Discovery chemistry', programmes_led: '2', patent_families: '2' }),
      row('pharma.scientist', 's2', { scientist_ref: 'S-02', function: 'Clinical operations', programmes_led: '0', patent_families: '1' }),
    ];
    expect(keyScientists(evidence, []).map((entry) => [entry.scientistRef, entry.concentrated])).toEqual([['S-01', true], ['S-02', false]]);
    // Until any document has been read, a retention agreement may still arrive: the check waits.
    expect(PHARMA_KEY_SCIENTIST.detect({ evidence, pages: [] })).toEqual([]);
    expect(PHARMA_KEY_SCIENTIST.detect({ evidence, pages: [supply] })).toMatchObject([{ key: 'S-01:key-scientist', domain: 'PEOPLE', direction: -1 }]);
    expect(PHARMA_KEY_SCIENTIST.detect({ evidence, pages: [page('r', 'S-01 has signed a retention agreement running to 2029.')] })).toEqual([]);
  });

  it('drafts R&D flat across the years against a timeline brought forward; one year, or rising spend, drafts nothing', () => {
    const pnl = (account: string, year: string, amount: string, kind: string) => row('finance.pnl_line', `${account}:${year}`, { account, month: year, amount, line_kind: kind });
    const years = ['2023', '2024', '2025'];
    const evidence = years.flatMap((year, index) => [pnl('Royalty revenue', year, String(20000000 + index * 3000000), 'REVENUE'), pnl('Research and development', year, ['22000000', '22300000', '22100000'][index] ?? '0', 'OPEX')]);
    const deck = page('deck', 'Investor presentation (synthetic). We have brought forward the PX-410 Phase 2 readout from 2028-Q4 to 2027-Q4.');
    expect(timelineAccelerations([deck])).toMatchObject([{ from: '2028-Q4', to: '2027-Q4' }]);
    expect(rdBurn(evidence)).toMatchObject({ flat: true });
    expect(PHARMA_BURN_VS_TIMELINE.detect({ evidence, pages: [deck] })).toMatchObject([{ key: 'rd-flat:2023-2025', direction: -1 }]);
    expect(PHARMA_BURN_VS_TIMELINE.detect({ evidence: evidence.filter((entry) => entry.canonical['month'] === '2025'), pages: [deck] })).toEqual([]);
    const rising = evidence.map((entry) => (entry.canonical['account'] === 'Research and development' ? { ...entry, canonical: { ...entry.canonical, amount: String(Number(entry.canonical['amount']) * (1 + Number(entry.canonical['month']) - 2023)) } } : entry));
    expect(PHARMA_BURN_VS_TIMELINE.detect({ evidence: rising, pages: [deck] })).toEqual([]);
  });

  it('the claims rule records each claim for the claims register, with the direction its status gives', () => {
    const evidence = [programme('PX-410', 'Phase 2', '', ''), trial('CT-1', 'PX-410', 'Phase 1', 'recruiting')];
    expect(PHARMA_PIPELINE_CLAIMS.detect({ evidence, pages: [] })).toEqual([]);
    const [proposal] = PHARMA_PIPELINE_CLAIMS.detect({ evidence, pages: [page('memo', 'Information memorandum (synthetic).')] });
    expect(proposal).toMatchObject({ key: 'PX-410:phase:contradicted', title: 'Claim contradicted: PX-410 phase', direction: -1, claim: { status: 'CONTRADICTED', statement: 'PX-410 (Indication) is in Phase 2' } });
  });
});
