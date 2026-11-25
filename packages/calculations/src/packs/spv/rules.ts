import { D } from '../../metrics/decimal';
import { amountOf, grouped, INVOICE_LINE, monthName, percent } from '../common';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRulePage, type PackRuleProposal, type PackRuleQuote } from '../rule-types';
import { billedMrr, capTableOf } from '../venture/rules';
import { instrumentStatements, roundClaims, roundStatement, sideLetters, spvDocuments, vehicleStatement, type VehicleTerms } from './documents';
import { spvEconomics } from './economics';
import { spvRoundCheck } from './round';

/**
 * Startup equity SPV pack rules (T-141, ADR 0043). Two directions of diligence: the round the
 * vehicle buys into (cap-table math, instrument terms, the startup's claims) and the vehicle itself
 * (fee and carry, side letters, the Form D). Deterministic, cited, drafts only: an organizer's
 * reviewer decides. Round defects that change what the vehicle pays for are drags (−1); vehicle
 * disclosure defects are organizer-side and neutral (0) — they are corrected and disclosed, not
 * priced. Diligence support only: never legal advice, never an accreditation determination.
 */
export const SPV_CAP_TABLE = 'venture.cap_table_row';
export const SPV_FINANCIALS = 'venture.financials_month';
type Dec = InstanceType<typeof D>;

const capRows = (evidence: readonly PackRuleEvidence[]) => evidence.filter((row) => row.evidenceType === SPV_CAP_TABLE);
const yes = (value: string | null | undefined) => ['yes', 'true', 'y', '1'].includes((value ?? '').toLowerCase());
const proRataFrom = (evidence: readonly PackRuleEvidence[]) => {
  const rows = new Map(capRows(evidence).map((row) => [row.canonical['security_id'] ?? row.sourceRecordId, row]));
  return (securityId: string) => yes(rows.get(securityId)?.canonical['pro_rata']);
};
const cited = (rows: readonly PackRuleEvidence[]) => rows.slice(0, MAX_CITED).map((row) => row.id);
const quoteOf = (quote: PackRuleQuote) => ({ documentId: quote.documentId, pageNumber: quote.pageNumber, quote: quote.quote });

/** The round check over the evidence and pages the rule was given (shared with the SPV page). */
export function roundCheckOf(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]) {
  const documents = spvDocuments(pages);
  const round = roundStatement(documents);
  return { documents, round, check: spvRoundCheck(capTableOf(evidence), round, proRataFrom(evidence)) };
}

/**
 * Cap-table and round math: the post-round fully diluted share count recomputed from the cap
 * table (with every SAFE and note converted) against the one the round summary states; new shares
 * × price against the round size; price × pre-round shares against the stated pre-money (the
 * valuation claim, VERIFIED or CONTRADICTED). A difference that is exactly what an instrument
 * converts into is named.
 */
export const SPV_CAP_TABLE_MATH: PackRule = {
  id: 'spv-cap-table-math',
  version: '1',
  evidenceTypes: [SPV_CAP_TABLE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = capRows(evidence);
    const { round, check } = roundCheckOf(evidence, pages);
    if (rows.length === 0 || !round.pricePerShare) return [];
    const currency = check.currency ?? '';
    const proposals: PackRuleProposal[] = [];
    const post = check.postRoundShares;
    if (post.ties === false && round.postRoundShares && post.recomputed && post.difference) {
      const difference = new D(post.difference);
      const explained = check.explainedBy
        ? ` The difference is exactly what ${check.explainedBy.join(' and ')} convert${check.explainedBy.length === 1 ? 's' : ''} into (${check.conversions
            .filter((entry) => check.explainedBy?.includes(entry.securityId))
            .map((entry) => `${entry.securityId}: ${grouped(new D(entry.shares))} shares at ${currency} ${entry.price} on its ${entry.basis === 'CAP' ? 'cap' : entry.basis === 'DISCOUNT' ? 'discount' : 'round price'}`)
            .join('; ')}) — the summary leaves the conversion out.`
        : '';
      proposals.push({
        key: `post:${post.stated}:${post.recomputed}`,
        domain: 'FINANCIAL',
        title: 'Cap table does not add up after the round',
        description: `The round summary states ${grouped(new D(post.stated ?? '0'))} fully diluted shares after the round; the cap table gives ${grouped(new D(post.recomputed))} (${grouped(new D(check.preRoundShares))} pre-round + ${grouped(new D(check.conversionShares))} from SAFEs and notes + ${grouped(new D(check.newShares ?? '0'))} new) — ${grouped(difference.abs())} shares ${difference.gt(0) ? 'more' : 'fewer'}.${explained} The vehicle's ownership and every return figure rest on the right count.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'More shares outstanding than the summary says means the vehicle owns less of the company for the same money.',
        evidenceIds: cited(rows),
        quotes: [quoteOf(round.postRoundShares.quote)],
        claim: { statement: round.postRoundShares.quote.quote, status: 'CONTRADICTED', rationale: `The cap table with every SAFE and note converted gives ${post.recomputed} shares after the round (${check.version}).` },
      });
    }
    if (check.roundSize.ties === false && round.roundSize && round.newShares) {
      proposals.push({
        key: `size:${check.roundSize.stated}:${check.roundSize.recomputed}`,
        domain: 'FINANCIAL',
        title: 'Round size does not match shares × price',
        description: `${grouped(round.newShares.value)} new shares at ${currency} ${check.pricePerShare} is ${currency} ${grouped(new D(check.roundSize.recomputed ?? '0'))}; the summary states a round of ${currency} ${grouped(round.roundSize.value.amount)}.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'A round whose arithmetic does not hold changes what each share costs the vehicle.',
        evidenceIds: [],
        quotes: [quoteOf(round.roundSize.quote), quoteOf(round.newShares.quote)],
      });
    }
    if (round.preMoney && check.preMoney.ties !== null) {
      const ties = check.preMoney.ties;
      const basis = `${currency} ${check.pricePerShare} per share × ${grouped(new D(check.preRoundShares))} pre-round shares is ${currency} ${grouped(new D(check.preMoney.recomputed ?? '0'))}`;
      proposals.push(
        ties
          ? {
              key: 'pre-money:ties',
              domain: 'FINANCIAL',
              title: 'Stated pre-money ties to the cap table',
              description: `The stated pre-money of ${currency} ${grouped(round.preMoney.value.amount)} matches the cap table: ${basis}.`,
              severity: 'LOW',
              confidence: 'HIGH',
              direction: 1,
              valueConfirmation: { valueDriver: 'Round valuation verified against the cap table', impliedValue: null, basis: `${basis}.` },
              evidenceIds: cited(rows),
              quotes: [quoteOf(round.preMoney.quote)],
              claim: { statement: round.preMoney.quote.quote, status: 'VERIFIED', rationale: `${basis}.` },
            }
          : {
              key: `pre-money:${check.preMoney.stated}:${check.preMoney.recomputed}`,
              domain: 'FINANCIAL',
              title: 'Stated pre-money does not tie to the cap table',
              description: `The summary states a pre-money of ${currency} ${grouped(round.preMoney.value.amount)}; ${basis}.`,
              severity: 'HIGH',
              confidence: 'HIGH',
              direction: -1,
              directionRationale: 'A valuation that does not follow from the price and the share count is a different price than the one stated.',
              evidenceIds: cited(rows),
              quotes: [quoteOf(round.preMoney.quote)],
              claim: { statement: round.preMoney.quote.quote, status: 'CONTRADICTED', rationale: `${basis}.` },
            },
      );
    }
    return proposals;
  },
};

const fraction = (value: Dec | null) => (value ? `${value.times(100).toFixed()}%` : 'none');
const money = (value: { currency: string; amount: Dec } | null | undefined) => (value ? `${value.currency} ${grouped(value.amount)}` : 'none');

/**
 * Instrument terms against the claims: each signed SAFE or note's cap, discount, MFN and pro-rata
 * against the round summary's prior-round statement (CONTRADICTED or VERIFIED), and against the
 * cap table import the conversion math reads. A summary claim with no signed instrument in the
 * evidence is UNVERIFIED.
 */
export const SPV_INSTRUMENT_TERMS: PackRule = {
  id: 'spv-instrument-terms',
  version: '1',
  evidenceTypes: [SPV_CAP_TABLE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const documents = spvDocuments(pages);
    const prior = roundStatement(documents).priorRound;
    const instruments = instrumentStatements(documents);
    const proposals: PackRuleProposal[] = [];
    if (prior && instruments.length === 0)
      proposals.push({
        key: 'prior-round:no-instrument',
        domain: 'LEGAL',
        title: 'Prior-round terms with no signed instrument behind them',
        description: `The round summary describes the prior round (“${prior.quote.quote}”), and no signed SAFE or note is in the evidence to check it against.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A gap, not a defect: ask the startup for the signed instruments before relying on the summary.',
        evidenceIds: [],
        quotes: [quoteOf(prior.quote)],
        claim: { statement: prior.quote.quote, status: 'UNVERIFIED', rationale: 'No signed SAFE or note in the evidence.' },
      });
    if (prior && instruments.length > 0) {
      const differences = instruments.flatMap((instrument) => {
        const name = instrument.securityId?.value ?? 'the signed instrument';
        return [
          ...(prior.value.cap && instrument.cap && !prior.value.cap.eq(instrument.cap.value.amount) ? [{ text: `${name} caps at ${money(instrument.cap.value)}, the summary at ${grouped(prior.value.cap)}`, quote: instrument.cap.quote }] : []),
          ...(prior.value.discount && instrument.discount && !prior.value.discount.eq(instrument.discount.value) ? [{ text: `${name} discounts ${fraction(instrument.discount.value)}, the summary ${fraction(prior.value.discount)}`, quote: instrument.discount.quote }] : []),
          ...(prior.value.mfn !== null && instrument.mfn && prior.value.mfn !== instrument.mfn.value ? [{ text: `${name} ${instrument.mfn.value ? 'has' : 'has no'} most-favoured-nation clause; the summary says ${prior.value.mfn ? 'it does' : 'it does not'}`, quote: instrument.mfn.quote }] : []),
          ...(prior.value.proRata !== null && instrument.proRata && prior.value.proRata !== instrument.proRata.value ? [{ text: `${name} ${instrument.proRata.value ? 'grants' : 'grants no'} pro-rata right; the summary says ${prior.value.proRata ? 'it does' : 'it does not'}`, quote: instrument.proRata.quote }] : []),
        ];
      });
      proposals.push(
        differences.length > 0
          ? {
              key: `prior-round:contradicted:${differences.map((entry) => entry.text).join('|')}`,
              domain: 'LEGAL',
              title: 'Signed instrument terms differ from the round summary',
              description: `${differences.map((entry) => entry.text).join('; ')}. The signed instrument governs the conversion; the summary investors read does not match it.`,
              severity: 'HIGH',
              confidence: 'HIGH',
              direction: -1,
              directionRationale: 'Better terms for prior holders than the summary states means more conversion shares ahead of the vehicle.',
              evidenceIds: [],
              quotes: [quoteOf(prior.quote), ...differences.slice(0, 5).map((entry) => quoteOf(entry.quote))],
              claim: { statement: prior.quote.quote, status: 'CONTRADICTED', rationale: `${differences.map((entry) => entry.text).join('; ')}.` },
            }
          : {
              key: 'prior-round:verified',
              domain: 'LEGAL',
              title: 'Prior-round terms match the signed instruments',
              description: `The round summary’s prior-round terms match ${instruments.length} signed instrument${instruments.length === 1 ? '' : 's'} in the evidence.`,
              severity: 'LOW',
              confidence: 'HIGH',
              direction: 1,
              valueConfirmation: { valueDriver: 'Prior-round terms verified against the signed instruments', impliedValue: null, basis: 'Cap, discount, MFN and pro-rata as stated, where stated.' },
              evidenceIds: [],
              quotes: [quoteOf(prior.quote), ...instruments.slice(0, 5).map((instrument) => quoteOf(instrument.cap?.quote ?? instrument.heading))],
              claim: { statement: prior.quote.quote, status: 'VERIFIED', rationale: `Matches the signed instrument${instruments.length === 1 ? '' : 's'}.` },
            },
      );
    }
    // The cap table import the conversion reads, against the signed instruments it should mirror.
    const rows = new Map(capRows(evidence).map((row) => [row.canonical['security_id'] ?? row.sourceRecordId, row]));
    for (const instrument of instruments) {
      const id = instrument.securityId?.value;
      const row = id ? rows.get(id) : undefined;
      if (!row || !instrument.securityId) continue;
      const importCap = row.canonical['valuation_cap'] ? amountOf(row, 'valuation_cap') : null;
      const importPrincipal = row.canonical['principal'] ? amountOf(row, 'principal') : null;
      const mismatch = [
        ...(instrument.cap && importCap && !importCap.eq(instrument.cap.value.amount) ? [`cap ${grouped(importCap)} in the cap table, ${money(instrument.cap.value)} signed`] : []),
        ...(instrument.principal && importPrincipal && !importPrincipal.eq(instrument.principal.value.amount) ? [`principal ${grouped(importPrincipal)} in the cap table, ${money(instrument.principal.value)} signed`] : []),
      ];
      if (mismatch.length === 0) continue;
      proposals.push({
        key: `import:${id}:${mismatch.join('|')}`,
        domain: 'FINANCIAL',
        title: `Cap table differs from the signed ${id}`,
        description: `${mismatch.join('; ')}. The conversion math reads the cap table; correct it to the signed instrument.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Conversion shares computed from the wrong terms misstate what the vehicle owns.',
        evidenceIds: [row.id],
        quotes: [quoteOf(instrument.securityId.quote)],
      });
    }
    return proposals;
  },
};

/** Claims with no source this pack reads (a gap: ask for the document behind them). */
const NO_SOURCE: Readonly<Record<string, string>> = {
  NRR: 'No cohort or retention data is in the evidence to check it against.',
  GROSS_MARGIN: 'No income statement or cost data is in the evidence to check it against.',
  CUSTOMERS: 'No customer list is in the evidence to check it against.',
};

/**
 * The round claims register: every material claim in the round summary or deck — traction (ARR,
 * MRR), runway, retention, margin, customers — checked against the evidence where the pack holds
 * it (billing; monthly cash and burn) and VERIFIED (+1, within 0.5%) or CONTRADICTED (−1, more
 * than 2% apart; runway two months or more short). A claim with nothing to check it against is
 * UNVERIFIED: a gap finding (0).
 */
export const SPV_ROUND_CLAIMS: PackRule = {
  id: 'spv-round-claims',
  version: '1',
  evidenceTypes: [INVOICE_LINE, SPV_FINANCIALS],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const claims = roundClaims(spvDocuments(pages));
    const billed = billedMrr(evidence);
    const months = evidence
      .filter((row) => row.evidenceType === SPV_FINANCIALS && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''))
      .sort((a, b) => (a.canonical['month'] ?? '').localeCompare(b.canonical['month'] ?? ''));
    return claims.flatMap((claim): PackRuleProposal[] => {
      const quotes = [quoteOf(claim.quote)];
      const unverified = (reason: string): PackRuleProposal => ({
        key: `${claim.key}:unverified`,
        domain: 'FINANCIAL',
        title: `Round claim not verified: ${claim.label}`,
        description: `The round summary states “${claim.quote.quote}” ${reason} Ask the startup for the document behind it before relying on it.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A gap, not a defect: an unverified claim is neither priced nor relied on.',
        evidenceIds: [],
        quotes,
        claim: { statement: claim.quote.quote, status: 'UNVERIFIED', rationale: reason },
      });
      const settled = (status: 'VERIFIED' | 'CONTRADICTED', basis: string, rows: readonly PackRuleEvidence[], detail: string): PackRuleProposal =>
        status === 'VERIFIED'
          ? {
              key: `${claim.key}:verified`,
              domain: 'FINANCIAL',
              title: `Round claim verified: ${claim.label}`,
              description: `“${claim.quote.quote}” ${detail}`,
              severity: 'LOW',
              confidence: 'HIGH',
              direction: 1,
              valueConfirmation: { valueDriver: `${claim.label} verified`, impliedValue: null, basis },
              evidenceIds: cited(rows),
              quotes,
              claim: { statement: claim.quote.quote, status, rationale: basis },
            }
          : {
              key: `${claim.key}:contradicted`,
              domain: 'FINANCIAL',
              title: `Round claim contradicted: ${claim.label}`,
              description: `“${claim.quote.quote}” ${detail}`,
              severity: 'HIGH',
              confidence: 'HIGH',
              direction: -1,
              directionRationale: 'The vehicle would be buying in on a figure the evidence does not support.',
              evidenceIds: cited(rows),
              quotes,
              claim: { statement: claim.quote.quote, status, rationale: basis },
            };
      if (claim.key === 'ARR' || claim.key === 'MRR') {
        if (!billed || !billed.mrr.gt(0)) return [unverified('No billing is in the evidence to check it against.')];
        if (claim.currency !== billed.currency) return [unverified(`Billing is in ${billed.currency}, the claim in ${claim.currency ?? 'no currency'}.`)];
        const actual = claim.key === 'ARR' ? billed.mrr.times(12) : billed.mrr;
        const gap = claim.value.minus(actual).div(actual);
        const basis = `Billing gives ${billed.currency} ${grouped(actual)} ${claim.key} for ${monthName(billed.month)} (each line normalized to a month).`;
        if (gap.abs().lte('0.005')) return [settled('VERIFIED', basis, billed.lines, `ties to billing. ${basis}`)];
        if (gap.abs().gt('0.02')) return [settled('CONTRADICTED', basis, billed.lines, `is ${percent(gap.abs())} ${gap.gt(0) ? 'above' : 'below'} billing. ${basis}`)];
        return [];
      }
      if (claim.key === 'RUNWAY') {
        if (months.length < 3) return [unverified('Fewer than three months of cash and burn are in the evidence to check it against.')];
        const recent = months.slice(-3);
        const latest = recent.at(-1) as PackRuleEvidence;
        const burn = recent.reduce((sum, row) => sum.plus(amountOf(row, 'net_burn')), new D(0)).div(recent.length);
        if (!burn.gt(0)) return [];
        const runway = amountOf(latest, 'cash_balance').div(burn);
        const basis = `Cash of ${grouped(amountOf(latest, 'cash_balance'))} at ${monthName(latest.canonical['month'] ?? '')} over an average net burn of ${grouped(burn)} (last three months) is ${runway.toFixed(1)} months.`;
        if (claim.value.minus(runway).gte(2)) return [settled('CONTRADICTED', basis, recent, `is ${claim.value.minus(runway).toFixed(1)} months longer than the evidence gives. ${basis}`)];
        if (claim.value.minus(runway).abs().lt(1)) return [settled('VERIFIED', basis, recent, `agrees with the evidence. ${basis}`)];
        return [];
      }
      return [unverified(NO_SOURCE[claim.key] ?? 'Nothing in the evidence checks it.')];
    });
  },
};

/**
 * Fee and carry: the operating agreement's management fee, carried interest and expense cap
 * against the investor summary's (a drag for each that differs: investors were told a lower cost).
 */
export const SPV_FEE_CARRY: PackRule = {
  id: 'spv-fee-carry',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const vehicle = vehicleStatement(spvDocuments(pages));
    if (!vehicle.agreement || !vehicle.summary) return [];
    const economics = spvEconomics(vehicle, new D(0), null);
    const quotes = (term: string) => {
      const pick = (terms: VehicleTerms | null) => (term === 'MANAGEMENT_FEE' ? terms?.managementFee?.quote : term === 'CARRY' ? terms?.carry?.quote : terms?.expenseCap?.quote);
      return [pick(vehicle.agreement), pick(vehicle.summary)].flatMap((quote) => (quote ? [quoteOf(quote)] : []));
    };
    return economics.comparisons
      .filter((comparison) => comparison.matches === false)
      .map((comparison) => ({
        key: `${comparison.term}:${comparison.agreement}:${comparison.summary}`,
        domain: 'LEGAL' as const,
        title: `${comparison.label} in the operating agreement differs from the investor summary`,
        description: `The operating agreement sets ${comparison.label.toLowerCase()} at ${comparison.agreement}; the summary investors were given says ${comparison.summary}. The operating agreement governs, so investors bear the higher figure unless it is corrected and disclosed.`,
        severity: comparison.term === 'EXPENSE_CAP' ? ('MEDIUM' as const) : ('HIGH' as const),
        confidence: 'HIGH' as const,
        direction: -1 as const,
        directionRationale: 'The vehicle’s economics cost investors more than the summary states: a drag on every net return.',
        evidenceIds: [],
        quotes: quotes(comparison.term),
      }));
  },
};

const EFFECT_LABEL = { FEE_WAIVER: 'waives the management fee', FEE_RATE: 'sets a different management fee', CARRY_RATE: 'sets a different carry', INFORMATION_RIGHTS: 'grants information rights', CO_INVESTMENT: 'grants co-investment rights', OTHER: 'grants other terms' } as const;

/**
 * Side letters: one that grants economics (a fee waiver, a different fee or carry) while the
 * investor summary discloses no side letter is an organizer-side finding (0: disclose it; it is
 * not a price term). Investors appear only by their pseudonymous reference.
 */
export const SPV_SIDE_LETTERS: PackRule = {
  id: 'spv-side-letters',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const documents = spvDocuments(pages);
    const vehicle = vehicleStatement(documents);
    if (vehicle.sideLetterDisclosure?.value === 'DISCLOSED') return [];
    return sideLetters(documents)
      .filter((letter) => letter.effects.some((effect) => effect.economic))
      .map((letter) => {
        const economic = letter.effects.filter((effect) => effect.economic);
        const who = letter.investorRef ? `investor ${letter.investorRef}` : 'one investor';
        return {
          key: `${letter.documentId}:${economic.map((effect) => effect.kind).join(',')}`,
          domain: 'LEGAL' as const,
          title: 'Side letter grants preferential terms the summary does not disclose',
          description: `A side letter for ${who} ${economic.map((effect) => EFFECT_LABEL[effect.kind]).join(' and ')}; ${vehicle.sideLetterDisclosure ? `the investor summary says “${vehicle.sideLetterDisclosure.quote.quote}”` : 'the investor summary says nothing about side letters'}. Disclose preferential economics to every investor (with counsel), or withdraw them. Only the organizer sees this; no investor sees another's terms.`,
          severity: 'HIGH' as const,
          confidence: 'HIGH' as const,
          direction: 0 as const,
          directionRationale: 'A disclosure defect in the vehicle, corrected in its documents: it does not change the price the vehicle pays for its line.',
          evidenceIds: [],
          quotes: [quoteOf(letter.heading), ...economic.map((effect) => quoteOf(effect.quote)), ...(vehicle.sideLetterDisclosure ? [quoteOf(vehicle.sideLetterDisclosure.quote)] : [])],
        };
      });
  },
};

/** No Form D filing evidence for the vehicle's offering: a gap finding to the organizer (0). */
export const SPV_FORM_D: PackRule = {
  id: 'spv-form-d',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const vehicle = vehicleStatement(spvDocuments(pages));
    const anchor = vehicle.exemption?.quote ?? vehicle.agreementHeading ?? vehicle.summaryHeading;
    if (vehicle.formD || !anchor) return [];
    return [
      {
        key: 'missing',
        domain: 'REGULATORY',
        title: 'No Form D filing evidence for the offering',
        description: `The vehicle's documents describe an exempt offering${vehicle.exemption ? ` (“${vehicle.exemption.quote.quote}”)` : ''}, and no Form D notice or filing confirmation is in the evidence. Counsel confirms whether and when it was filed.`,
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        direction: 0,
        directionRationale: 'A filing gap for the organizer to close with counsel; it is not a price term.',
        evidenceIds: [],
        quotes: [quoteOf(anchor)],
      },
    ];
  },
};

export const SPV_RULES: readonly PackRule[] = [SPV_CAP_TABLE_MATH, SPV_INSTRUMENT_TERMS, SPV_ROUND_CLAIMS, SPV_FEE_CARRY, SPV_SIDE_LETTERS, SPV_FORM_D];

/** One investor seat as the accreditation check reads it: a pseudonymous reference and a tracked status. */
export interface SpvSeat {
  readonly reference: string;
  readonly status: string;
  readonly accreditation: string;
}

export const SPV_ACCREDITATION_CHECK_ID = 'spv-accreditation';
export const SPV_ACCREDITATION_CHECK_VERSION = '1';

/**
 * The accreditation gap: under Rule 506(c) every investor must be verified accredited by reasonable
 * steps (tracked here as THIRD_PARTY_VERIFIED); anyone else is an organizer-side finding (0). Under
 * 506(b) a NOT_ACCREDITED investor is flagged too. Seats are not evidence, so the SPV service runs
 * this with the pages; it cites the sentence stating the exemption. Pactlab determines nothing.
 */
export function spvAccreditationCheck(pages: readonly PackRulePage[], seats: readonly SpvSeat[]): PackRuleProposal[] {
  const vehicle = vehicleStatement(spvDocuments(pages));
  if (!vehicle.exemption) return [];
  const active = seats.filter((seat) => seat.status === 'ACTIVE');
  const c = vehicle.exemption.value === 'RULE_506C';
  const gaps = active.filter((seat) => (c ? seat.accreditation !== 'THIRD_PARTY_VERIFIED' : seat.accreditation === 'NOT_ACCREDITED'));
  if (gaps.length === 0) return [];
  const refs = gaps.map((seat) => `${seat.reference} (${seat.accreditation.toLowerCase().replaceAll('_', ' ')})`).sort();
  return [
    {
      key: `${vehicle.exemption.value}:${refs.join(',')}`,
      domain: 'REGULATORY',
      title: c ? 'Accreditation gap in a 506(c) vehicle' : 'Investor recorded as not accredited',
      description: c
        ? `The vehicle is offered under Rule 506(c) (“${vehicle.exemption.quote.quote}”), which needs every investor's accredited status verified by reasonable steps. ${gaps.length} of ${active.length} seated investor${active.length === 1 ? ' is' : 's are'} not recorded as third-party verified: ${refs.join(', ')}. Have a verification specialist confirm them before closing; Pactlab makes no accreditation determination.`
        : `${refs.join(', ')} ${gaps.length === 1 ? 'is' : 'are'} recorded as not accredited in a Rule 506(b) vehicle (“${vehicle.exemption.quote.quote}”). Review with counsel before closing; Pactlab makes no accreditation determination.`,
      severity: 'HIGH',
      confidence: 'HIGH',
      direction: 0,
      directionRationale: 'An eligibility gap in the vehicle’s own offering, for the organizer and counsel: it does not change the round’s price.',
      evidenceIds: [],
      quotes: [quoteOf(vehicle.exemption.quote)],
    },
  ];
}
