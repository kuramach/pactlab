import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { telecomMetrics } from './metrics';
import { TELECOM_CAPEX_SQUEEZE, TELECOM_CONTENT_SQUEEZE, TELECOM_COUNTERPARTY_CONCENTRATION, TELECOM_RIGHTS_WINDOW, TELECOM_SUBSCRIBER_CLAIMS } from './rules';
import { addMonthsToDate, checkClaims, movementMonths, rightsWindow, squeezeYears, subscriberClaims, subscriberYears, trailingSubscribers } from './subscribers';

const months = (from: string, count: number) => {
  const out: string[] = [];
  let [year, month] = from.split('-').map(Number) as [number, number];
  for (let i = 0; i < count; i += 1) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) [year, month] = [year + 1, 1];
  }
  return out;
};

/** 1,000 opening subscribers each month, `churn` per thousand disconnects, ARPU 50 (synthetic). */
const movement = (month: string, disconnects = 10, arpu = 50): PackRuleEvidence => ({
  id: `m-${month}`,
  evidenceType: 'telecom.subscriber_movement',
  sourceRecordId: `${month}|North|Fibre`,
  canonical: { month, region: 'North', plan: 'Fibre', opening_subscribers: '1000', gross_adds: String(disconnects), disconnects: String(disconnects), closing_subscribers: '1000', service_revenue: String(1000 * arpu) },
});
const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const deck = page('deck', 'Northlake Fibre — investor presentation (synthetic). We billed 1,000 subscribers on 30 September 2026. Average monthly churn was 0.9% over the twelve months. ARPU was USD 50.00 a month. The expected closing date is 31 December 2026.');

describe('telecom subscriber model (T-168)', () => {
  const twelve = months('2025-10', 12).map((month) => movement(month, 15));

  it('recomputes churn and ARPU over the trailing twelve months', () => {
    const trailing = trailingSubscribers(movementMonths(twelve));
    expect(trailing).toMatchObject({ from: '2025-10', to: '2026-09', missing: [] });
    expect(trailing?.churn?.toFixed(4)).toBe('0.0150');
    expect(trailing?.arpu?.toFixed(2)).toBe('50.00');
    expect(trailing?.closing.toFixed(0)).toBe('1000');
  });

  it('reads deck claims, never the extracts or a KPI line with a colon', () => {
    const extracts = page('x', 'Northlake — data-room extracts (synthetic). 5,000 subscribers churn was 4% ARPU was USD 9');
    const kpi = page('k', 'KPI pack (synthetic). Subscribers at 30 September 2026: 1,100 Monthly churn: 0.9%');
    expect(subscriberClaims([extracts, kpi])).toEqual([]);
    expect(subscriberClaims([deck]).map((claim) => [claim.key, claim.value.toString()])).toEqual([['SUBSCRIBERS', '1000'], ['CHURN', '0.009'], ['ARPU', '50']]);
  });

  it('marks each claim verified, contradicted or unverified', () => {
    expect(checkClaims(twelve, [deck]).map((check) => [check.claim.key, check.status])).toEqual([['SUBSCRIBERS', 'VERIFIED'], ['CHURN', 'CONTRADICTED'], ['ARPU', 'VERIFIED']]);
    const proposals = TELECOM_SUBSCRIBER_CLAIMS.detect({ evidence: twelve, pages: [deck] });
    const churn = proposals.find((proposal) => proposal.key === 'CHURN:contradicted');
    expect(churn).toMatchObject({ title: 'Claim contradicted: Monthly churn', direction: -1, claim: { status: 'CONTRADICTED' } });
    expect(churn?.description).toContain('180 disconnects on 12,000 opening subscribers for October 2025 to September 2026, 1.5% a month');
    expect(proposals.find((proposal) => proposal.key === 'ARPU:verified')).toMatchObject({ direction: 1, valueConfirmation: expect.anything() });
    // Eleven months only: nothing can be checked.
    expect(TELECOM_SUBSCRIBER_CLAIMS.detect({ evidence: twelve.slice(1), pages: [deck] }).map((proposal) => [proposal.key, proposal.direction])).toEqual([['SUBSCRIBERS:unverified', 0], ['CHURN:unverified', 0], ['ARPU:unverified', 0]]);
    // An annual churn is a twelfth of itself a month.
    const annual = page('d2', 'Annual churn was 18% last year.');
    expect(checkClaims(twelve, [annual]).map((check) => check.status)).toEqual(['VERIFIED']);
  });

  it('reads each year only when all twelve months are imported', () => {
    expect(subscriberYears(movementMonths(months('2023-01', 30).map((month) => movement(month)))).map((year) => year.year)).toEqual(['2023', '2024']);
  });
});

describe('telecom rights window (T-168)', () => {
  const billing = months('2025-10', 12).map((month, index): PackRuleEvidence => ({ id: `b-${index}`, evidenceType: 'billing.invoice_line', sourceRecordId: `b-${index}`, canonical: { amount: '100000', currency: 'USD', period_start: `${month}-01` } }));
  const agreement = (id: string, value: string, endsOn: string, autoRenews = 'no'): PackRuleEvidence => ({
    id: `a-${id}`,
    evidenceType: 'telecom.agreement',
    sourceRecordId: id,
    canonical: { agreement_id: id, counterparty: `${id} Cable (synthetic)`, kind: 'affiliate', flow: 'receivable', annual_value: value, ends_on: endsOn, auto_renews: autoRenews },
  });
  const register = [agreement('AF-01', '120000', '2028-06-30'), agreement('AF-02', '30000', '2027-03-31'), agreement('AF-03', '200000', '2027-06-30', 'yes')];
  const contract = [page('af', 'Affiliation agreement AF-01 between Northlake and AF-01 Cable (synthetic).'), page('af', '14.1 Term. Agreement AF-01 expires on 30 September 2027. 14.2 Agreement AF-01 does not renew automatically.', 2)];

  it('adds whole months to a date, clamped to the month end', () => {
    expect(addMonthsToDate('2026-12-31', 12)).toBe('2027-12-31');
    expect(addMonthsToDate('2027-01-31', 1)).toBe('2027-02-28');
  });

  it('a document’s end date governs over the register, measured from the expected closing', () => {
    const window = rightsWindow([...billing, ...register], [deck, ...contract]);
    expect(window.from).toMatchObject({ date: '2026-12-31', basis: 'EXPECTED_CLOSING' });
    expect(window.agreements.map((status) => [status.agreement.agreementId, status.endsOn, status.endBasis, status.state, status.material])).toEqual([
      ['AF-03', '2027-06-30', 'REGISTER', 'RENEWS', true],
      ['AF-01', '2027-09-30', 'DOCUMENT', 'ENDS_IN_WINDOW', true],
      ['AF-02', '2027-03-31', 'REGISTER', 'ENDS_IN_WINDOW', false],
    ]);
  });

  it('drafts only a material agreement ending in the window that does not renew', () => {
    const proposals = TELECOM_RIGHTS_WINDOW.detect({ evidence: [...billing, ...register], pages: [deck, ...contract] });
    expect(proposals.map((proposal) => proposal.title)).toEqual(['Material agreement ends within 12 months of the closing: AF-01']);
    expect(proposals[0]?.description).toMatch(/ends on 30 September 2027 \(as the agreement states\), 9 months after the closing, measured from the expected closing of 31 December 2026; it states it does not renew automatically/);
    expect(proposals[0]?.description).toContain('10.0% of the 1,200,000');
    expect(proposals[0]?.quotes?.map((quote) => quote.quote)).toEqual(['Agreement AF-01 expires on 30 September 2027.', '14.2 Agreement AF-01 does not renew automatically.', 'The expected closing date is 31 December 2026.']);
    // Waits for the documents, which may govern.
    expect(TELECOM_RIGHTS_WINDOW.detect({ evidence: [...billing, ...register], pages: [] })).toEqual([]);
  });
});

describe('telecom counterparty concentration and squeezes (T-168)', () => {
  const stream = (month: string, counterparty: string, amount: string, kind = 'advertising'): PackRuleEvidence => ({ id: `s-${month}-${counterparty}`, evidenceType: 'telecom.revenue_month', sourceRecordId: `${month}|${kind}|${counterparty}`, canonical: { month, stream: kind, counterparty, amount } });

  it('one advertiser at 30% or more of advertising revenue is drafted; a spread affiliate stream is not', () => {
    const rows = months('2025-10', 12).flatMap((month) => [stream(month, 'Brightline Motors (synthetic)', '34'), stream(month, 'Other A', '33'), stream(month, 'Other B', '33'), ...['A', 'B', 'C', 'D'].map((name) => stream(month, `Distributor ${name}`, '25', 'affiliate'))]);
    const proposals = TELECOM_COUNTERPARTY_CONCENTRATION.detect({ evidence: rows, pages: [] });
    expect(proposals.map((proposal) => proposal.title)).toEqual(['Advertising revenue concentrated in one counterparty: Brightline Motors (synthetic)']);
    expect(proposals[0]?.description).toMatch(/paid 408 of the 1,200 advertising revenue for October 2025 to September 2026, 34\.0%, 17\.0% of all 2,400/);
  });

  const pnl = (year: string, account: string, amount: string, kind: string): PackRuleEvidence => ({ id: `p-${account}-${year}`, evidenceType: 'finance.pnl_line', sourceRecordId: `${account}|${year}`, canonical: { account, month: year, amount, line_kind: kind } });
  const years = ['2023', '2024', '2025'];
  const flat = years.flatMap((year) => months(`${year}-01`, 12).map((month) => movement(month, 10)));
  const statement = (content: readonly string[]) => years.flatMap((year, index) => [pnl(year, 'Subscription revenue', '600000', 'REVENUE'), pnl(year, 'Cost of content and programming', content[index] ?? '0', 'COGS')]);

  it('content cost per subscriber rising against flat ARPU is a squeeze; a single year is not', () => {
    const evidence = [...flat, ...statement(['120000', '144000', '174000'])];
    expect(squeezeYears(evidence).map((year) => [year.year, year.arpu.toFixed(2), year.contentPerSubscriber?.toFixed(2)])).toEqual([['2023', '50.00', '10.00'], ['2024', '50.00', '12.00'], ['2025', '50.00', '14.50']]);
    const [found] = TELECOM_CONTENT_SQUEEZE.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ title: 'Content costs rising against flat ARPU, 2023–2025', direction: -1 });
    expect(found?.description).toContain('fell from 40.00 to 35.50');
    expect(TELECOM_CONTENT_SQUEEZE.detect({ evidence: [...flat, ...statement(['120000', '144000', '174000']).filter((row) => row.canonical['month'] === '2025')], pages: [] })).toEqual([]);
    // Rising ARPU absorbs it.
    const rising = years.flatMap((year, index) => months(`${year}-01`, 12).map((month) => movement(month, 10, 50 + index * 5)));
    expect(TELECOM_CONTENT_SQUEEZE.detect({ evidence: [...rising, ...statement(['120000', '144000', '174000'])], pages: [] })).toEqual([]);
  });

  it('capex intensity rising against flat ARPU is a squeeze', () => {
    const capex = (year: string, amount: string): PackRuleEvidence => ({ id: `c-${year}`, evidenceType: 'telecom.capex_year', sourceRecordId: `${year}|network`, canonical: { year, category: 'network', amount } });
    const evidence = [...flat, ...statement(['1', '1', '1']), capex('2023', '100000'), capex('2024', '120000'), capex('2025', '140000')];
    expect(TELECOM_CAPEX_SQUEEZE.detect({ evidence, pages: [] }).map((proposal) => proposal.title)).toEqual(['Capex intensity rising against flat ARPU, 2023–2025']);
    expect(TELECOM_CAPEX_SQUEEZE.detect({ evidence: [...flat, ...statement(['1', '1', '1']), capex('2023', '100000'), capex('2024', '110000'), capex('2025', '105000')], pages: [] })).toEqual([]);
  });

  it('the calculator names the import a missing figure needs', () => {
    const report = telecomMetrics({ currency: 'USD', evidence: months('2025-10', 12).map((month) => movement(month, 15)) });
    expect(report).toMatchObject({ calculator: 'telecom-subscribers', version: 'telecom-subscribers-1' });
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['monthly_churn']?.value).toBe('0.0150');
    expect(byKey['arpu']?.value).toBe('50.00');
    expect(byKey['largest_advertising_share']).toMatchObject({ value: null, needs: ['TELECOM_REVENUE_STREAMS'] });
    expect(byKey['capex_intensity']).toMatchObject({ value: null, needs: ['TELECOM_CAPEX', 'FINANCIAL_PNL'] });
  });
});
