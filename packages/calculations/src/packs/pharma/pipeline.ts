import { D, parseDecimal } from '../../metrics/decimal';
import { expectedClosing, wholeMonths } from '../clinics/practice';
import { INVOICE_LINE, rowMonth } from '../common';
import { dateIn, lastDayOfMonth } from '../fintech/payments';
import { statedHoldYears } from '../music/catalog';
import { trendOf } from '../pnl-trend';
import type { KeyExpense, TrendYear } from '../../pnl/trend';
import { sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The pharma and biotech pipeline model (T-163, ADR 0053), deterministic and decimal-only: the checks a
 * buyer can make without scientific judgment. Each programme's phase, status and timeline claim (the
 * seller's pipeline schedule) against the trial-registry records and the regulatory correspondence
 * supplied as evidence; the patent estate's expiries (a patent record that states one governs) against
 * the hold after closing; the milestones, royalties and fees the agreements state against the seller's
 * obligations model; single-source manufacturing and key-scientist concentration; and R&D spend across
 * the imported P&L years against a timeline the documents say was brought forward. Every figure names
 * the rows or the sentence it rests on. It never opines on efficacy, approvability or trial design.
 * Changing a rule is a new PHARMA_PIPELINE_VERSION, never a silent edit.
 */
export const PHARMA_PIPELINE_VERSION = 'pharma-pipeline-1';
export const PROGRAMME = 'pharma.programme';
export const PATENT = 'pharma.patent';
export const REGISTRY_TRIAL = 'pharma.registry_trial';
export const OBLIGATION = 'pharma.obligation';
export const SCIENTIST = 'pharma.scientist';

type Decimal = InstanceType<typeof D>;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const quoteOf = (page: PackRulePage, sentence: string): PackRuleQuote => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) });
const NEGATED = /\b(?:no|not|none|without|nor|never)\b/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (sentence: string, token: string) => token !== '' && new RegExp(`(?<![A-Za-z0-9-])${escape(token)}(?![A-Za-z0-9])`, 'i').test(sentence);

/** Every sentence of a document's pages, in page order, with the document's heading (its first sentence). */
function documents(pages: readonly PackRulePage[]): { documentId: string; heading: string; sentences: { page: PackRulePage; sentence: string }[] }[] {
  const byDocument = new Map<string, PackRulePage[]>();
  for (const page of pages) byDocument.set(page.documentId, [...(byDocument.get(page.documentId) ?? []), page]);
  return [...byDocument.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([documentId, own]) => {
      const all = [...own].sort((a, b) => a.pageNumber - b.pageNumber).flatMap((page) => sentences(page.text).map((sentence) => ({ page, sentence })));
      return { documentId, heading: all[0]?.sentence ?? '', sentences: all };
    });
}

// ------------------------------------------------------------------ phases

const ROMAN: Readonly<Record<string, number>> = { i: 1, ii: 2, iii: 3, iv: 4 };
const PHASE = /\bphase\s*(1|2|3|4|iv|iii|ii|i)\b(?:\s*\/\s*(?:phase\s*)?(1|2|3|4|iv|iii|ii|i)\b)?/i;
const numeral = (value: string) => ROMAN[value.toLowerCase()] ?? Number(value);

/**
 * A phase as a rank that orders combined phases between their parts: preclinical 0, Phase 1 2,
 * Phase 1/2 3, Phase 2 4, Phase 2/3 5, Phase 3 6, Phase 4 8. Null when the text names no phase.
 */
export function phaseRank(value: string): number | null {
  if (/\bpre-?clinical\b/i.test(value)) return 0;
  const match = PHASE.exec(value);
  if (!match) return null;
  const first = numeral(match[1] ?? '');
  const second = match[2] ? numeral(match[2]) : null;
  return second !== null && second > first ? second * 2 - 1 : first * 2;
}

export function phaseLabel(rank: number): string {
  if (rank === 0) return 'Preclinical';
  return rank % 2 === 0 ? `Phase ${rank / 2}` : `Phase ${(rank - 1) / 2}/${(rank + 1) / 2}`;
}

// ------------------------------------------------------------------ the pipeline and the registry

export interface Programme {
  readonly evidenceId: string;
  readonly programme: string;
  readonly indication: string;
  readonly phase: string;
  readonly phaseRank: number | null;
  readonly nextMilestone: string;
  readonly expected: string;
}

/** The seller's pipeline schedule (`pharma.programme`), by programme code. */
export function programmes(evidence: readonly PackRuleEvidence[]): Programme[] {
  return evidence
    .filter((row) => row.evidenceType === PROGRAMME && text(row, 'programme'))
    .map((row) => ({
      evidenceId: row.id,
      programme: text(row, 'programme'),
      indication: text(row, 'indication'),
      phase: text(row, 'phase'),
      phaseRank: phaseRank(text(row, 'phase')),
      nextMilestone: text(row, 'next_milestone'),
      expected: text(row, 'expected'),
    }))
    .sort((a, b) => a.programme.localeCompare(b.programme));
}

/** Registry statuses that mean a trial is not running. */
const HALTED = new Set(['suspended', 'terminated', 'withdrawn']);

export interface RegistryTrial {
  readonly evidenceId: string;
  readonly registryId: string;
  readonly programme: string;
  readonly phase: string;
  readonly phaseRank: number | null;
  readonly status: string;
  readonly halted: boolean;
  readonly startDate: string | null;
  readonly primaryCompletion: string | null;
}

/** The trial-registry records supplied as evidence (`pharma.registry_trial`). */
export function registryTrials(evidence: readonly PackRuleEvidence[]): RegistryTrial[] {
  return evidence
    .filter((row) => row.evidenceType === REGISTRY_TRIAL && text(row, 'registry_id'))
    .map((row) => {
      const status = text(row, 'status').toLowerCase().replaceAll(/[_,]+/g, ' ').replaceAll(/\s+/g, ' ');
      const date = (field: string) => (ISO_DATE.test(text(row, field)) ? text(row, field) : null);
      return {
        evidenceId: row.id,
        registryId: text(row, 'registry_id'),
        programme: text(row, 'programme'),
        phase: text(row, 'phase'),
        phaseRank: phaseRank(text(row, 'phase')),
        status,
        halted: HALTED.has(status),
        startDate: date('start_date'),
        primaryCompletion: date('primary_completion'),
      };
    })
    .sort((a, b) => a.registryId.localeCompare(b.registryId));
}

/** A document is regulatory correspondence or a registry filing when its heading says so. */
const CORRESPONDENCE_HEADING = /\b(?:registry|registration|regulator|regulatory|FDA|EMA|MHRA|Food and Drug Administration|European Medicines Agency|meeting minutes|correspondence|IND|clinical trial application)\b/i;

/** Sentences of the regulatory correspondence that name a programme and a phase. */
export function correspondenceMentions(pages: readonly PackRulePage[], programme: string): { phaseRank: number; quote: PackRuleQuote }[] {
  return documents(pages)
    .filter((document) => CORRESPONDENCE_HEADING.test(document.heading))
    .flatMap((document) =>
      document.sentences.flatMap(({ page, sentence }) => {
        const rank = mentions(sentence, programme) ? phaseRank(sentence) : null;
        return rank === null ? [] : [{ phaseRank: rank, quote: quoteOf(page, sentence) }];
      }),
    );
}

/** The last day of a period written "2027-Q2", "Q2 2027", "2027-06" or "2027". */
export function periodEnd(value: string): string | null {
  const trimmed = value.trim();
  const isoQuarter = /^(\d{4})-?Q([1-4])$/i.exec(trimmed);
  const wordQuarter = /^Q([1-4])\s+(\d{4})$/i.exec(trimmed);
  const [year, quarter] = isoQuarter ? [isoQuarter[1], isoQuarter[2]] : wordQuarter ? [wordQuarter[2], wordQuarter[1]] : [null, null];
  if (year && quarter) return lastDayOfMonth(`${year}-${String(Number(quarter) * 3).padStart(2, '0')}`);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) return lastDayOfMonth(trimmed);
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-12-31`;
  return null;
}

export type ClaimStatus = 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED';
export type ClaimAspect = 'PHASE' | 'TIMELINE' | 'STATUS';

export interface PipelineClaim {
  readonly programme: string;
  readonly aspect: ClaimAspect;
  /** What the pipeline schedule says, in words. */
  readonly statement: string;
  readonly status: ClaimStatus;
  /** What the evidence says, in words. */
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly quotes: readonly PackRuleQuote[];
}

const DATA_MILESTONE = /\b(?:data|read-?out|results)\b/i;

/**
 * Each programme's claims against the registry records and the correspondence: the phase (verified when a
 * registered trial — or, with none registered, the correspondence — reaches the claimed phase; contradicted
 * when the latest phase evidenced is earlier), the timeline of a data readout (the registered primary
 * completion of the trial at the milestone's phase against the end of the expected period), and the status
 * (contradicted when every registered trial is suspended, terminated or withdrawn). Unverified when nothing
 * supplied bears on it.
 */
export function pipelineClaims(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): PipelineClaim[] {
  const trials = registryTrials(evidence);
  return programmes(evidence).flatMap((entry): PipelineClaim[] => {
    const own = trials.filter((trial) => trial.programme.toLowerCase() === entry.programme.toLowerCase());
    const live = own.filter((trial) => trial.status !== 'withdrawn' && trial.phaseRank !== null);
    const claims: PipelineClaim[] = [];
    if (entry.phaseRank !== null) {
      const statement = `${entry.programme} (${entry.indication}) is in ${entry.phase}`;
      const claimed = phaseLabel(entry.phaseRank);
      const best = live.reduce<RegistryTrial | null>((top, trial) => (!top || (trial.phaseRank ?? -1) > (top.phaseRank ?? -1) ? trial : top), null);
      const letters = correspondenceMentions(pages, entry.programme);
      if (best && best.phaseRank !== null) {
        const filed = `${best.registryId} is registered as ${best.phase} (${best.status})`;
        const others = live.filter((trial) => trial !== best).map((trial) => `${trial.registryId} ${trial.phase}`);
        const registered = `${filed}${others.length ? `; also ${others.join(', ')}` : ''}`;
        claims.push(
          best.phaseRank >= entry.phaseRank
            ? { programme: entry.programme, aspect: 'PHASE', statement, status: 'VERIFIED', rationale: `${registered}, which reaches the claimed ${claimed}.`, evidenceIds: [entry.evidenceId, ...live.map((trial) => trial.evidenceId)], quotes: letters.slice(0, 3).map((letter) => letter.quote) }
            : {
                programme: entry.programme,
                aspect: 'PHASE',
                statement,
                status: 'CONTRADICTED',
                rationale: `The latest phase registered is ${phaseLabel(best.phaseRank)}: ${registered}. No ${claimed} trial is registered for ${entry.programme}.`,
                evidenceIds: [entry.evidenceId, ...live.map((trial) => trial.evidenceId)],
                quotes: letters.slice(0, 3).map((letter) => letter.quote),
              },
        );
      } else if (letters.length > 0) {
        const latest = Math.max(...letters.map((letter) => letter.phaseRank));
        claims.push({
          programme: entry.programme,
          aspect: 'PHASE',
          statement,
          status: latest >= entry.phaseRank ? 'VERIFIED' : 'CONTRADICTED',
          rationale:
            latest >= entry.phaseRank
              ? `No trial is registered for ${entry.programme}; the regulatory correspondence names it at ${phaseLabel(latest)}.`
              : `No trial is registered for ${entry.programme}; the latest phase the regulatory correspondence names is ${phaseLabel(latest)}.`,
          evidenceIds: [entry.evidenceId],
          quotes: letters.slice(0, 3).map((letter) => letter.quote),
        });
      } else {
        claims.push({ programme: entry.programme, aspect: 'PHASE', statement, status: 'UNVERIFIED', rationale: `No registry record or regulatory correspondence for ${entry.programme} is in the evidence.`, evidenceIds: [entry.evidenceId], quotes: [] });
      }
    }

    const end = periodEnd(entry.expected);
    if (DATA_MILESTONE.test(entry.nextMilestone) && end) {
      const statement = `${entry.programme}: ${entry.nextMilestone} expected ${entry.expected}`;
      const atPhase = phaseRank(entry.nextMilestone) ?? entry.phaseRank;
      const trial = live.filter((candidate) => candidate.phaseRank === atPhase).sort((a, b) => (b.primaryCompletion ?? '').localeCompare(a.primaryCompletion ?? ''))[0];
      const phaseWord = atPhase !== null ? phaseLabel(atPhase) : 'the';
      if (!trial || !trial.primaryCompletion)
        claims.push({
          programme: entry.programme,
          aspect: 'TIMELINE',
          statement,
          status: 'UNVERIFIED',
          rationale: trial ? `${trial.registryId} has no registered primary completion date.` : `No ${phaseWord} trial for ${entry.programme} is registered, so no primary completion date bears on the readout.`,
          evidenceIds: [entry.evidenceId, ...(trial ? [trial.evidenceId] : [])],
          quotes: [],
        });
      else
        claims.push({
          programme: entry.programme,
          aspect: 'TIMELINE',
          statement,
          status: trial.primaryCompletion <= end ? 'VERIFIED' : 'CONTRADICTED',
          rationale:
            trial.primaryCompletion <= end
              ? `${trial.registryId}'s registered primary completion is ${trial.primaryCompletion}, within ${entry.expected} (by ${end}).`
              : `${trial.registryId}'s registered primary completion is ${trial.primaryCompletion}, after the end of ${entry.expected} (${end}): the data cannot read out by then on the registered dates.`,
          evidenceIds: [entry.evidenceId, trial.evidenceId],
          quotes: [],
        });
    }

    if (own.length > 0 && own.every((trial) => trial.halted))
      claims.push({
        programme: entry.programme,
        aspect: 'STATUS',
        statement: `${entry.programme} is an active programme (it is on the pipeline schedule)`,
        status: 'CONTRADICTED',
        rationale: `Every trial registered for ${entry.programme} has stopped: ${own.map((trial) => `${trial.registryId} ${trial.status}`).join(', ')}.`,
        evidenceIds: [entry.evidenceId, ...own.map((trial) => trial.evidenceId)],
        quotes: [],
      });
    return claims;
  });
}

// ------------------------------------------------------------------ the patent estate

export interface PatentEntry {
  readonly evidenceId: string;
  readonly family: string;
  readonly product: string;
  readonly jurisdiction: string;
  readonly type: string;
  /** Composition-of-matter: the protection the rest of a product's estate is measured against. */
  readonly core: boolean;
  readonly scheduleExpiry: string | null;
  /** The expiry that governs: a patent record's, else the schedule's. */
  readonly expiry: string | null;
  readonly basis: 'DOCUMENT' | 'SCHEDULE';
  readonly quote: PackRuleQuote | null;
}

const EXPIRY_WORD = /\bexpir(?:es|ed|e|y|ing)\b/i;

const PATENT_HEADING = /\bpatents?\b/i;

/**
 * The expiry a patent record states for a family in a jurisdiction ("Patent family PF-01 (US) … expires on
 * 31 March 2028"): a document whose heading names a patent, one sentence naming the family and the
 * jurisdiction, the date after the expiry word.
 */
export function patentRecordExpiry(pages: readonly PackRulePage[], family: string, jurisdiction: string): { date: string; quote: PackRuleQuote } | null {
  for (const document of documents(pages)) {
    if (!PATENT_HEADING.test(document.heading)) continue;
    for (const { page, sentence } of document.sentences) {
      if (!mentions(sentence, family) || !mentions(sentence, jurisdiction)) continue;
      const at = sentence.search(EXPIRY_WORD);
      const date = at >= 0 ? dateIn(sentence.slice(at)) : null;
      if (date) return { date, quote: quoteOf(page, sentence) };
    }
  }
  return null;
}

/** The patent schedule (`pharma.patent`), each row's expiry read from a patent record where one states it. */
export function patentEstate(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): PatentEntry[] {
  return evidence
    .filter((row) => row.evidenceType === PATENT && text(row, 'family'))
    .map((row) => {
      const family = text(row, 'family');
      const jurisdiction = text(row, 'jurisdiction');
      const scheduleExpiry = ISO_DATE.test(text(row, 'expiry')) ? text(row, 'expiry') : null;
      const record = patentRecordExpiry(pages, family, jurisdiction);
      return {
        evidenceId: row.id,
        family,
        product: text(row, 'product'),
        jurisdiction,
        type: text(row, 'type'),
        core: /composition/i.test(text(row, 'type')),
        scheduleExpiry,
        expiry: record?.date ?? scheduleExpiry,
        basis: record ? ('DOCUMENT' as const) : ('SCHEDULE' as const),
        quote: record?.quote ?? null,
      };
    })
    .sort((a, b) => a.product.localeCompare(b.product) || a.family.localeCompare(b.family) || a.jurisdiction.localeCompare(b.jurisdiction));
}

/** The hold the patent check assumes when no document states "hold period of N years". */
export const PHARMA_DEFAULT_HOLD_YEARS = 5;

/** The analysis date: the last day of the latest billed month; null with no billing import. */
export function pharmaAnalysisDate(evidence: readonly PackRuleEvidence[]): string | null {
  const latest = evidence
    .filter((row) => row.evidenceType === INVOICE_LINE)
    .map((row) => rowMonth(row))
    .filter((month): month is string => month !== null)
    .sort()
    .at(-1);
  return latest ? lastDayOfMonth(latest) : null;
}

const addYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

export interface HoldWindow {
  /** The stated expected closing, else the analysis date. */
  readonly from: string;
  readonly basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE';
  readonly closingQuote: PackRuleQuote | null;
  readonly years: number;
  readonly yearsStated: boolean;
  readonly to: string;
}

/** The hold after closing: from the expected closing a document states (else the analysis date), for the hold a document states (else the default). */
export function holdWindow(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): HoldWindow | null {
  const closing = expectedClosing(pages);
  const from = closing?.date ?? pharmaAnalysisDate(evidence);
  if (!from) return null;
  const hold = statedHoldYears(pages);
  const years = hold.stated ? hold.years : PHARMA_DEFAULT_HOLD_YEARS;
  return { from, basis: closing ? 'EXPECTED_CLOSING' : 'ANALYSIS_DATE', closingQuote: closing?.quote ?? null, years, yearsStated: hold.stated, to: addYears(from, years) };
}

export interface ProductRevenue {
  /** Trailing twelve months to the latest billed month, from the billing lines that name the product. */
  readonly annual: Decimal;
  readonly currency: string | null;
  readonly evidenceIds: readonly string[];
  readonly from: string;
  readonly to: string;
}

/** A product's trailing twelve months of billed revenue: the lines whose counterparty names it ("royalties on Product A"). */
export function productRevenue(evidence: readonly PackRuleEvidence[], product: string): ProductRevenue | null {
  const lines = evidence.filter((row) => row.evidenceType === INVOICE_LINE && rowMonth(row));
  const latest = lines.map((row) => rowMonth(row) as string).sort().at(-1);
  if (!latest || !product) return null;
  const [year = 0, month = 0] = latest.split('-').map(Number);
  const first = month === 12 ? `${year}-01` : `${year - 1}-${String(month + 1).padStart(2, '0')}`;
  const own = lines.filter((row) => {
    const at = rowMonth(row) as string;
    return at >= first && at <= latest && mentions(row.canonical['customer_name'] ?? '', product);
  });
  if (own.length === 0) return null;
  const currencies = new Set(own.map((row) => row.canonical['currency'] ?? ''));
  return {
    annual: own.reduce((total, row) => total.plus(dec(row.canonical['amount']) ?? 0), new D(0)),
    currency: currencies.size === 1 ? ([...currencies][0] ?? null) : null,
    evidenceIds: own.map((row) => row.id),
    from: first,
    to: latest,
  };
}

export type CliffState = 'IN_HOLD' | 'AFTER_HOLD' | 'BEFORE_CLOSING' | 'NO_DATE';

export interface ProductCliff {
  readonly product: string;
  /** The rows the cliff is measured on: the composition-of-matter patents, else every patent of the product. */
  readonly basis: readonly PatentEntry[];
  readonly coreBasis: boolean;
  /** The first jurisdiction where the product's protection ends: each jurisdiction's latest expiry, the earliest of them. */
  readonly cliff: string | null;
  readonly jurisdiction: string | null;
  readonly state: CliffState;
  /** Whole months from the start of the hold to the cliff (negative when it ends before). */
  readonly monthsAfterClosing: number | null;
  /** Years of the hold left after the cliff, to two places. */
  readonly yearsOfHoldAfter: Decimal | null;
  readonly revenue: ProductRevenue | null;
}

/** Each product's patent cliff against the hold. */
export function productCliffs(estate: readonly PatentEntry[], hold: HoldWindow | null, evidence: readonly PackRuleEvidence[]): ProductCliff[] {
  const products = [...new Set(estate.map((entry) => entry.product))].filter(Boolean).sort();
  return products.map((product) => {
    const own = estate.filter((entry) => entry.product === product);
    const core = own.filter((entry) => entry.core);
    const basis = core.length > 0 ? core : own;
    const byJurisdiction = new Map<string, string>();
    for (const entry of basis) if (entry.expiry && entry.expiry > (byJurisdiction.get(entry.jurisdiction) ?? '')) byJurisdiction.set(entry.jurisdiction, entry.expiry);
    const first = [...byJurisdiction.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))[0];
    const cliff = first?.[1] ?? null;
    const state: CliffState = !cliff || !hold ? 'NO_DATE' : cliff <= hold.from ? 'BEFORE_CLOSING' : cliff <= hold.to ? 'IN_HOLD' : 'AFTER_HOLD';
    const monthsAfterClosing = cliff && hold ? wholeMonths(hold.from, cliff) : null;
    const yearsOfHoldAfter = cliff && hold && state === 'IN_HOLD' ? new D(wholeMonths(cliff, hold.to)).div(12).toDecimalPlaces(2) : null;
    return { product, basis, coreBasis: core.length > 0, cliff, jurisdiction: first?.[0] ?? null, state, monthsAfterClosing, yearsOfHoldAfter, revenue: productRevenue(evidence, product) };
  });
}

// ------------------------------------------------------------------ obligations

export type ObligationKind = 'milestone' | 'royalty' | 'licence_fee';

export interface ModelObligation {
  readonly evidenceId: string;
  readonly obligationId: string;
  readonly counterparty: string;
  readonly kind: string;
  readonly trigger: string;
  readonly amount: Decimal | null;
  readonly rate: Decimal | null;
  readonly expected: string;
}

/** The seller's model of what it owes (`pharma.obligation`). A rate written as a percentage ("6%") is read as a fraction. */
export function modelObligations(evidence: readonly PackRuleEvidence[]): ModelObligation[] {
  return evidence
    .filter((row) => row.evidenceType === OBLIGATION && text(row, 'obligation_id'))
    .map((row) => {
      const rateText = text(row, 'rate');
      const rate = dec(rateText.replace('%', ''));
      return {
        evidenceId: row.id,
        obligationId: text(row, 'obligation_id'),
        counterparty: text(row, 'counterparty'),
        kind: text(row, 'kind').toLowerCase(),
        trigger: text(row, 'trigger'),
        amount: dec(text(row, 'amount')),
        rate: rate === null ? null : rateText.includes('%') || rate.gt(1) ? rate.div(100) : rate,
        expected: text(row, 'expected'),
      };
    })
    .sort((a, b) => a.obligationId.localeCompare(b.obligationId));
}

const MONEY = /([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/;
const MILESTONE = /\bshall pay (.+?) a milestone payment of ([A-Z]{3}\s*[0-9][0-9,]*(?:\.[0-9]+)?)\s+(?:on|upon|at|within [^,]+? of|following)\s+(.+?)\.?$/i;
const ROYALTY = /\bshall pay (.+?) (?:a )?royalt(?:y|ies) of (\d+(?:\.\d+)?)\s?% (?:of|on) (.+?)\.?$/i;
const FEE = /\bshall pay (.+?) an? annual (?:licen[cs]e|maintenance) fee of ([A-Z]{3}\s*[0-9][0-9,]*(?:\.[0-9]+)?)/i;

export interface AgreementObligation {
  readonly kind: ObligationKind;
  readonly payee: string;
  /** For a milestone, the event the agreement says makes it due. */
  readonly trigger: string | null;
  readonly amount: Decimal | null;
  readonly currency: string | null;
  /** For a royalty, the rate as a fraction of the base the agreement names. */
  readonly rate: Decimal | null;
  readonly quote: PackRuleQuote;
}

const money = (value: string) => {
  const match = MONEY.exec(value);
  const amount = match ? dec(match[2]) : null;
  return match && amount ? { currency: match[1] ?? '', amount } : null;
};

/**
 * The payments the agreements oblige the company to make, each read from one sentence: "… shall pay <payee> a
 * milestone payment of USD 12,000,000 upon <event>", "… shall pay <payee> a royalty of 6% of net sales …",
 * "… shall pay <payee> an annual licence fee of USD 250,000". What no sentence states is not an obligation.
 */
export function agreementObligations(pages: readonly PackRulePage[]): AgreementObligation[] {
  const found: AgreementObligation[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const milestone = MILESTONE.exec(sentence);
      const royalty = milestone ? null : ROYALTY.exec(sentence);
      const fee = milestone || royalty ? null : FEE.exec(sentence);
      let entry: AgreementObligation | null = null;
      if (milestone) {
        const paid = money(milestone[2] ?? '');
        entry = { kind: 'milestone', payee: milestone[1] ?? '', trigger: milestone[3] ?? '', amount: paid?.amount ?? null, currency: paid?.currency ?? null, rate: null, quote: quoteOf(page, sentence) };
      } else if (royalty) {
        entry = { kind: 'royalty', payee: royalty[1] ?? '', trigger: royalty[3] ?? null, amount: null, currency: null, rate: dec(royalty[2])?.div(100) ?? null, quote: quoteOf(page, sentence) };
      } else if (fee) {
        const paid = money(fee[2] ?? '');
        entry = { kind: 'licence_fee', payee: fee[1] ?? '', trigger: null, amount: paid?.amount ?? null, currency: paid?.currency ?? null, rate: null, quote: quoteOf(page, sentence) };
      }
      if (!entry) continue;
      // A copy of the same agreement (a data room often holds two) states each obligation once.
      const key = `${entry.kind}|${normalizeParty(entry.payee)}|${entry.trigger ? triggerSignature(entry.trigger) : ''}|${entry.amount?.toFixed(2) ?? ''}|${entry.rate?.toFixed(6) ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(entry);
    }
  }
  return found;
}

/** A counterparty's name without the marks a model and an agreement write differently. */
export function normalizeParty(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/\(synthetic\)/g, ' ')
    .replaceAll(/[^a-z0-9 ]+/g, ' ')
    .replaceAll(/\b(?:inc|ltd|llc|plc|bv|b v|nv|gmbh|ag|sa|limited|corporation|corp|the|company|co)\b/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}
const sameParty = (a: string, b: string) => {
  const [x, y] = [normalizeParty(a), normalizeParty(b)];
  return x !== '' && y !== '' && (x === y || x.includes(y) || y.includes(x));
};

const PROGRAMME_CODE = /\b([A-Z]{2,4}-\d{2,4})\b/;

/** What event a milestone is due on: the event kind, the phase and the programme code it names. */
export function triggerSignature(trigger: string): string {
  const event = /\bapprov|marketing authori[sz]ation/i.test(trigger)
    ? 'APPROVAL'
    : /first commercial sale|\blaunch/i.test(trigger)
      ? 'SALE'
      : /\b(?:fil(?:e|ing)|submission|submit)/i.test(trigger)
        ? 'FILING'
        : DATA_MILESTONE.test(trigger)
          ? 'DATA'
          : /\b(?:start|initiat\w*|commence\w*|first patient|dos(?:e|ed|ing))\b/i.test(trigger)
            ? 'START'
            : 'OTHER';
  return `${event}|${phaseRank(trigger) ?? ''}|${PROGRAMME_CODE.exec(trigger)?.[1] ?? ''}`;
}
const sameTrigger = (a: string, b: string) => {
  const [x, y] = [triggerSignature(a).split('|'), triggerSignature(b).split('|')];
  return x[0] === y[0] && x[1] === y[1] && (!x[2] || !y[2] || x[2] === y[2]);
};

export type ObligationState = 'IN_MODEL' | 'OMITTED' | 'UNDERSTATED' | 'RATE_UNDERSTATED';

export interface ObligationCheck {
  readonly obligation: AgreementObligation;
  readonly model: ModelObligation | null;
  readonly state: ObligationState;
  /** The agreement's amount less the model's, for an understated milestone or fee. */
  readonly gap: Decimal | null;
  /** When the pipeline schedule expects the milestone's event, if it names it. */
  readonly expected: { readonly programme: string; readonly milestone: string; readonly expected: string; readonly evidenceId: string } | null;
}

/**
 * Each obligation an agreement states, looked for in the seller's model: the same counterparty and kind
 * and, for a milestone, the same event, phase and programme. Missing is OMITTED; a lower amount is
 * UNDERSTATED (by more than one unit); a lower royalty rate is RATE_UNDERSTATED. A model line matches one
 * obligation at most.
 */
export function obligationChecks(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): { checks: ObligationCheck[]; unmatched: ModelObligation[] } {
  const model = modelObligations(evidence);
  const pipeline = programmes(evidence);
  const used = new Set<string>();
  const checks = agreementObligations(pages).map((obligation): ObligationCheck => {
    const match = model.find(
      (row) => !used.has(row.evidenceId) && row.kind === obligation.kind && sameParty(row.counterparty, obligation.payee) && (obligation.kind !== 'milestone' || sameTrigger(row.trigger, obligation.trigger ?? '')),
    );
    if (match) used.add(match.evidenceId);
    const code = obligation.trigger ? PROGRAMME_CODE.exec(obligation.trigger)?.[1] : undefined;
    const planned = code && obligation.trigger ? pipeline.find((entry) => entry.programme === code && entry.nextMilestone && sameTrigger(`${entry.nextMilestone} ${code}`, obligation.trigger ?? '')) : undefined;
    const expected = planned ? { programme: planned.programme, milestone: planned.nextMilestone, expected: planned.expected, evidenceId: planned.evidenceId } : null;
    if (!match) return { obligation, model: null, state: 'OMITTED', gap: null, expected };
    if (obligation.amount && obligation.amount.minus(match.amount ?? 0).gt(1)) return { obligation, model: match, state: 'UNDERSTATED', gap: obligation.amount.minus(match.amount ?? 0), expected };
    if (obligation.rate && match.rate !== null && obligation.rate.gt(match.rate)) return { obligation, model: match, state: 'RATE_UNDERSTATED', gap: null, expected };
    return { obligation, model: match, state: 'IN_MODEL', gap: null, expected };
  });
  return { checks, unmatched: model.filter((row) => !used.has(row.evidenceId)) };
}

// ------------------------------------------------------------------ dependence

const SOLE = /\b(?:sole|single|only|exclusive)\s+(?:source|supplier|manufacturer|contract manufacturer|CMO|manufacturing site)\b|\bmanufactured (?:solely|exclusively|only) by\b/i;
const SECOND_SOURCE = /\b(?:second|back-?up|alternative|dual|additional)\s+(?:source|supplier|manufacturer|manufacturing site|site|CMO)\b/i;

export interface ManufacturingDependence {
  readonly product: string;
  readonly sole: PackRuleQuote;
  /** The document's own sentence on a second source: in place, or stated as none. */
  readonly secondSource: { readonly inPlace: boolean; readonly quote: PackRuleQuote } | null;
  readonly singleSource: boolean;
}

/** Each product a document says one manufacturer or supplier makes, and whether the same document describes a second source. */
export function manufacturingDependence(pages: readonly PackRulePage[], products: readonly string[]): ManufacturingDependence[] {
  const docs = documents(pages);
  return [...new Set(products)].filter(Boolean).sort().flatMap((product) => {
    for (const document of docs) {
      const sole = document.sentences.find(({ sentence }) => mentions(sentence, product) && SOLE.test(sentence));
      if (!sole) continue;
      const second = document.sentences.find(({ sentence }) => sentence !== sole.sentence && SECOND_SOURCE.test(sentence));
      const secondSource = second ? { inPlace: !NEGATED.test(second.sentence), quote: quoteOf(second.page, second.sentence) } : null;
      return [{ product, sole: quoteOf(sole.page, sole.sentence), secondSource, singleSource: !secondSource?.inPlace }];
    }
    return [];
  });
}

/** A scientist leading this share of the programmes, or named on this share of the patent families, is a concentration. */
export const KEY_SCIENTIST_SHARE = '0.5';

export interface KeyScientist {
  readonly evidenceId: string;
  readonly scientistRef: string;
  readonly function: string;
  readonly programmesLed: Decimal;
  readonly programmeShare: Decimal | null;
  readonly patentFamilies: Decimal;
  readonly familyShare: Decimal | null;
  readonly concentrated: boolean;
  /** A document naming the reference with a retention, employment, consulting or non-compete agreement. */
  readonly retention: PackRuleQuote | null;
}

const RETENTION = /\b(?:retention|employment|consulting|non-?compete|non-?solicitation)\s+(?:agreement|arrangement|bonus|covenant|letter)s?\b/i;

/** The R&D roster against the pipeline and the patent estate: who leads half the programmes or is named on half the families. */
export function keyScientists(evidence: readonly PackRuleEvidence[], pages: readonly PackRulePage[]): KeyScientist[] {
  const programmeCount = programmes(evidence).length;
  const familyCount = new Set(evidence.filter((row) => row.evidenceType === PATENT).map((row) => text(row, 'family')).filter(Boolean)).size;
  const threshold = new D(KEY_SCIENTIST_SHARE);
  return evidence
    .filter((row) => row.evidenceType === SCIENTIST && text(row, 'scientist_ref'))
    .map((row) => {
      const ref = text(row, 'scientist_ref');
      const led = dec(text(row, 'programmes_led')) ?? new D(0);
      const families = dec(text(row, 'patent_families')) ?? new D(0);
      const programmeShare = programmeCount > 0 ? led.div(programmeCount) : null;
      const familyShare = familyCount > 0 ? families.div(familyCount) : null;
      const concentrated = (led.gte(2) && !!programmeShare?.gte(threshold)) || (families.gte(2) && !!familyShare?.gte(threshold));
      let retention: PackRuleQuote | null = null;
      for (const page of pages) {
        const sentence = sentences(page.text).find((candidate) => mentions(candidate, ref) && RETENTION.test(candidate) && !NEGATED.test(candidate));
        if (sentence) {
          retention = quoteOf(page, sentence);
          break;
        }
      }
      return { evidenceId: row.id, scientistRef: ref, function: text(row, 'function'), programmesLed: led, programmeShare, patentFamilies: families, familyShare, concentrated, retention };
    })
    .sort((a, b) => a.scientistRef.localeCompare(b.scientistRef));
}

// ------------------------------------------------------------------ R&D burn against the timeline

/** The pack's key expenses on the P&L trend: R&D first (the burn the timeline needs), then supply and royalties paid. */
export const PHARMA_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'rd', label: 'Research and development', pattern: /\b(?:research|r ?& ?d|clinical development|development costs?)\b/i },
  { key: 'supply', label: 'Manufacturing and supply costs', pattern: /\b(?:manufactur\w*|supply|cost of goods)\b/i },
  { key: 'royalties_paid', label: 'Royalties and milestones paid', pattern: /\b(?:royalt\w* (?:paid|payable|expense)|milestones? (?:paid|expense)|licen[cs]e fees? paid)\b/i },
];

/** R&D within this share of its first year in every year is flat. */
export const RD_FLAT_TOLERANCE = '0.05';

const PERIOD = /(\d{4}-Q[1-4]|Q[1-4] \d{4}|\d{4}-\d{2}|\d{4})/i;
const ACCELERATION = /\b(?:brought forward|pulled forward|accelerated|moved (?:up|forward))\b/i;

export interface TimelineAcceleration {
  readonly from: string;
  readonly to: string;
  readonly quote: PackRuleQuote;
}

/** A sentence saying a milestone was brought forward, from one period to an earlier one ("… brought forward from 2028-Q4 to 2027-Q4"). */
export function timelineAccelerations(pages: readonly PackRulePage[]): TimelineAcceleration[] {
  const found: TimelineAcceleration[] = [];
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      if (!ACCELERATION.test(sentence)) continue;
      const match = new RegExp(`\\bfrom ${PERIOD.source} to ${PERIOD.source}`, 'i').exec(sentence);
      const [from, to] = [periodEnd((match?.[1] ?? '').replace(/^(Q[1-4]) (\d{4})$/i, '$2-$1')), periodEnd((match?.[2] ?? '').replace(/^(Q[1-4]) (\d{4})$/i, '$2-$1'))];
      if (match && from && to && to < from && !found.some((other) => other.quote.quote === cap(sentence))) found.push({ from: match[1] ?? '', to: match[2] ?? '', quote: quoteOf(page, sentence) });
    }
  }
  return found;
}

export interface RdBurn {
  readonly years: readonly { readonly year: string; readonly amount: Decimal; readonly evidenceIds: readonly string[] }[];
  /** Every year within RD_FLAT_TOLERANCE of the first; null with fewer than two years of R&D. */
  readonly flat: boolean | null;
  /** The last year's R&D ÷ the first's − 1. */
  readonly change: Decimal | null;
}

/** R&D spend by imported fiscal year, from the P&L lines that name it. */
export function rdBurn(evidence: readonly PackRuleEvidence[]): RdBurn {
  const trend = trendOf(evidence, PHARMA_KEY_EXPENSES);
  const years = trend.years.flatMap((year: TrendYear) => {
    const rd = year.ratios.find((ratio) => ratio.key === 'rd');
    return rd && new D(rd.amount).gt(0) ? [{ year: year.year, amount: new D(rd.amount), evidenceIds: rd.evidenceIds }] : [];
  });
  const first = years[0];
  const last = years.at(-1);
  if (!first || !last || years.length < 2) return { years, flat: null, change: null };
  const tolerance = new D(RD_FLAT_TOLERANCE);
  return { years, flat: years.every((year) => year.amount.div(first.amount).minus(1).abs().lte(tolerance)), change: last.amount.div(first.amount).minus(1) };
}
