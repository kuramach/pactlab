import { D, parseDecimal } from '../../metrics/decimal';
import { collapse, sentences, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * Startup equity SPV (T-141): what the round's and the vehicle's documents state, read
 * deterministically from their pages. Every figure carries the exact sentence it came from (a
 * citation the API verifies on the page); a figure no document states is absent, never estimated.
 * No model reads these: the patterns below are the whole reader, versioned with the checks.
 */
type Dec = InstanceType<typeof D>;

export type SpvDocumentKind = 'ROUND_SUMMARY' | 'INSTRUMENT' | 'OPERATING_AGREEMENT' | 'INVESTOR_SUMMARY' | 'SIDE_LETTER' | 'FORM_D';

/** A figure with the sentence that states it. */
export interface Stated<T> {
  readonly value: T;
  readonly quote: PackRuleQuote;
}

export interface SpvDocument {
  readonly documentId: string;
  readonly kind: SpvDocumentKind;
  readonly pages: readonly PackRulePage[];
  /** The document's heading (its first sentence), for a citation that names it. */
  readonly heading: PackRuleQuote;
}

/**
 * A document's kind from its heading (the start of its first page). Order matters: a side letter
 * refers to the operating agreement, and an investor summary to the round, in their own text.
 */
const KINDS: readonly (readonly [SpvDocumentKind, RegExp])[] = [
  ['SIDE_LETTER', /\bSIDE LETTER\b/i],
  ['FORM_D', /\bFORM D\b|NOTICE OF EXEMPT OFFERING/i],
  ['INSTRUMENT', /SIMPLE AGREEMENT FOR FUTURE EQUITY|CONVERTIBLE (?:PROMISSORY )?NOTE/i],
  ['INVESTOR_SUMMARY', /SUMMARY OF TERMS|INVESTOR SUMMARY/i],
  ['OPERATING_AGREEMENT', /OPERATING AGREEMENT|LIMITED PARTNERSHIP AGREEMENT/i],
  ['ROUND_SUMMARY', /ROUND SUMMARY|TERM SHEET|PITCH DECK|INVESTOR DECK/i],
];
const HEADING_CHARS = 160;

/** The pact's SPV documents, grouped by document and recognised by heading. Other documents are ignored. */
export function spvDocuments(pages: readonly PackRulePage[]): SpvDocument[] {
  const byDocument = new Map<string, PackRulePage[]>();
  for (const page of pages) byDocument.set(page.documentId, [...(byDocument.get(page.documentId) ?? []), page]);
  const documents: SpvDocument[] = [];
  for (const [documentId, list] of byDocument) {
    const ordered = [...list].sort((a, b) => a.pageNumber - b.pageNumber);
    const first = ordered[0];
    if (!first) continue;
    const head = collapse(first.text).slice(0, HEADING_CHARS);
    const kind = KINDS.find(([, pattern]) => pattern.test(head))?.[0];
    if (!kind) continue;
    const heading = (sentences(first.text)[0] ?? head).slice(0, 200);
    documents.push({ documentId, kind, pages: ordered, heading: { documentId, pageNumber: first.pageNumber, quote: heading } });
  }
  return documents;
}

/** The shortest quote a citation accepts (`MIN_QUOTE_LENGTH` in @pactlab/ai). */
const MIN_QUOTE = 12;
const number = (raw: string | undefined): Dec | null => parseDecimal((raw ?? '').replaceAll(',', ''));

/** The first sentence across a document's pages that matches, with its captures. */
function stated(document: SpvDocument | undefined, pattern: RegExp): { match: RegExpMatchArray; quote: PackRuleQuote } | null {
  for (const page of document?.pages ?? []) {
    const list = sentences(page.text);
    for (const [index, sentence] of list.entries()) {
      const match = sentence.match(pattern);
      // A citation needs at least MIN_QUOTE chars: a short sentence ("Carry: 15%.") is quoted with its neighbour.
      const quote = sentence.length >= MIN_QUOTE ? sentence : [list[index - 1], sentence, list[index + 1]].filter(Boolean).join(' ');
      if (match) return { match, quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: quote.slice(0, 400) } };
    }
  }
  return null;
}
function money(document: SpvDocument | undefined, label: RegExp): Stated<{ currency: string; amount: Dec }> | null {
  const hit = stated(document, new RegExp(`(?:${label.source})[^.:]{0,30}:\\s*(?:(?:up to|capped at|at most)\\s+)?([A-Z]{3})\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)`, 'i'));
  const amount = number(hit?.match[2]);
  const currency = hit?.match[1] ?? '';
  return hit && amount && /^[A-Z]{3}$/.test(currency) ? { value: { currency, amount }, quote: hit.quote } : null;
}
function count(document: SpvDocument | undefined, label: RegExp): Stated<Dec> | null {
  const hit = stated(document, new RegExp(`(?:${label.source})[^.:]{0,30}:\\s*([0-9][0-9,]*)`, 'i'));
  const value = number(hit?.match[1]);
  return hit && value ? { value, quote: hit.quote } : null;
}
function percentOf(document: SpvDocument | undefined, label: RegExp): Stated<Dec> | null {
  const hit = stated(document, new RegExp(`(?:${label.source})[^.:]{0,30}:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*%`, 'i'));
  const value = number(hit?.match[1]);
  return hit && value ? { value: value.div(100), quote: hit.quote } : null;
}
const yesNo = (raw: string | undefined) => (raw ? /^yes/i.test(raw) : null);

/** The round as the round summary or deck states it. */
export interface RoundStatement {
  readonly preMoney: Stated<{ currency: string; amount: Dec }> | null;
  readonly roundSize: Stated<{ currency: string; amount: Dec }> | null;
  readonly pricePerShare: Stated<{ currency: string; amount: Dec }> | null;
  readonly newShares: Stated<Dec> | null;
  readonly postRoundShares: Stated<Dec> | null;
  /** Prior-round instrument terms as the summary describes them. */
  readonly priorRound: Stated<{ cap: Dec | null; discount: Dec | null; mfn: boolean | null; proRata: boolean | null }> | null;
}

export function roundStatement(documents: readonly SpvDocument[]): RoundStatement {
  const summary = documents.find((document) => document.kind === 'ROUND_SUMMARY');
  const prior = stated(summary, /prior round[^.]*/i);
  const priorText = prior?.quote.quote ?? '';
  const cap = number(priorText.match(/valuation cap of [A-Z]{3}\s*([0-9][0-9,]*)/i)?.[1]);
  const discount = number(priorText.match(/([0-9]+(?:\.[0-9]+)?)\s*% discount/i)?.[1]);
  return {
    preMoney: money(summary, /pre-money valuation/),
    roundSize: money(summary, /round size/),
    pricePerShare: money(summary, /price per share/),
    newShares: count(summary, /new shares issued/),
    postRoundShares: count(summary, /fully diluted shares after the round/),
    priorRound: prior
      ? {
          value: {
            cap,
            discount: discount ? discount.div(100) : null,
            mfn: /most[- ]favou?red[- ]nation/i.test(priorText) ? !/\bno most[- ]favou?red/i.test(priorText) : null,
            proRata: /pro[- ]rata/i.test(priorText) ? !/\bno pro[- ]rata/i.test(priorText) : null,
          },
          quote: prior.quote,
        }
      : null,
  };
}

/** A signed SAFE or note, as its own text states it. */
export interface InstrumentStatement {
  readonly documentId: string;
  readonly securityId: Stated<string> | null;
  readonly principal: Stated<{ currency: string; amount: Dec }> | null;
  readonly cap: Stated<{ currency: string; amount: Dec }> | null;
  readonly discount: Stated<Dec> | null;
  readonly mfn: Stated<boolean> | null;
  readonly proRata: Stated<boolean> | null;
  readonly heading: PackRuleQuote;
}

export function instrumentStatements(documents: readonly SpvDocument[]): InstrumentStatement[] {
  return documents
    .filter((document) => document.kind === 'INSTRUMENT')
    .map((document) => {
      const id = stated(document, /instrument(?: id)?:\s*([A-Z0-9][A-Z0-9-]{0,30})/i);
      const mfn = stated(document, /most[- ]favou?red[- ]nation:\s*(yes|no)/i);
      const proRata = stated(document, /pro[- ]rata rights?:\s*(yes|no)/i);
      return {
        documentId: document.documentId,
        securityId: id ? { value: id.match[1] ?? '', quote: id.quote } : null,
        principal: money(document, /purchase amount|principal amount/),
        cap: money(document, /valuation cap/),
        discount: percentOf(document, /discount rate/),
        mfn: mfn ? { value: yesNo(mfn.match[1]) === true, quote: mfn.quote } : null,
        proRata: proRata ? { value: yesNo(proRata.match[1]) === true, quote: proRata.quote } : null,
        heading: document.heading,
      };
    });
}

/** Fee, carry and expenses as one document states them. */
export interface VehicleTerms {
  readonly managementFee: Stated<{ rate: Dec; years: Dec }> | null;
  readonly carry: Stated<Dec> | null;
  readonly expenseCap: Stated<{ currency: string; amount: Dec }> | null;
  readonly organizerCommitment: Stated<{ currency: string; amount: Dec }> | null;
}

function vehicleTerms(document: SpvDocument | undefined): VehicleTerms {
  const fee = stated(document, /management fee:\s*([0-9]+(?:\.[0-9]+)?)\s*%[^.]*/i);
  const feeRate = number(fee?.match[1]);
  // "charged once" (the norm for an SPV) or "per year for N years".
  const years = fee ? (number(fee.quote.quote.match(/for ([0-9]+) years/i)?.[1]) ?? new D(1)) : null;
  return {
    managementFee: fee && feeRate && years ? { value: { rate: feeRate.div(100), years }, quote: fee.quote } : null,
    carry: percentOf(document, /carried interest|carry/),
    expenseCap: money(document, /expenses/),
    organizerCommitment: money(document, /organizer commitment|manager commitment/),
  };
}

export interface VehicleStatement {
  /** The operating agreement governs; the investor summary is what investors were told. */
  readonly agreement: VehicleTerms | null;
  readonly summary: VehicleTerms | null;
  readonly agreementHeading: PackRuleQuote | null;
  readonly summaryHeading: PackRuleQuote | null;
  /** The offering exemption the vehicle's documents state, with the sentence. */
  readonly exemption: Stated<'RULE_506B' | 'RULE_506C'> | null;
  /** What the summary says about side letters: NONE, DISCLOSED (with its text) or nothing at all. */
  readonly sideLetterDisclosure: Stated<'NONE' | 'DISCLOSED'> | null;
  readonly formD: PackRuleQuote | null;
}

export function vehicleStatement(documents: readonly SpvDocument[]): VehicleStatement {
  const agreement = documents.find((document) => document.kind === 'OPERATING_AGREEMENT');
  const summary = documents.find((document) => document.kind === 'INVESTOR_SUMMARY');
  const exemptionHit = stated(agreement, /Rule 506\s*\(([bc])\)/i) ?? stated(summary, /Rule 506\s*\(([bc])\)/i);
  const disclosure = stated(summary, /side letters?:\s*(.+)/i);
  const formD = documents.find((document) => document.kind === 'FORM_D');
  return {
    agreement: agreement ? vehicleTerms(agreement) : null,
    summary: summary ? vehicleTerms(summary) : null,
    agreementHeading: agreement?.heading ?? null,
    summaryHeading: summary?.heading ?? null,
    exemption: exemptionHit ? { value: (exemptionHit.match[1] ?? '').toLowerCase() === 'c' ? 'RULE_506C' : 'RULE_506B', quote: exemptionHit.quote } : null,
    sideLetterDisclosure: disclosure ? { value: /^(none|no side letters)/i.test((disclosure.match[1] ?? '').trim()) ? 'NONE' : 'DISCLOSED', quote: disclosure.quote } : null,
    formD: formD?.heading ?? null,
  };
}

/** What one side letter grants, and to which (pseudonymous) investor. */
export interface SideLetter {
  readonly documentId: string;
  readonly investorRef: string | null;
  readonly heading: PackRuleQuote;
  readonly effects: readonly { readonly kind: 'FEE_WAIVER' | 'FEE_RATE' | 'CARRY_RATE' | 'INFORMATION_RIGHTS' | 'CO_INVESTMENT' | 'OTHER'; readonly economic: boolean; readonly value: string | null; readonly quote: PackRuleQuote }[];
}

export function sideLetters(documents: readonly SpvDocument[]): SideLetter[] {
  return documents
    .filter((document) => document.kind === 'SIDE_LETTER')
    .map((document) => {
      const investor = stated(document, /investor reference:\s*([A-Z0-9][A-Z0-9-]{0,30})/i);
      const effects: SideLetter['effects'][number][] = [];
      const waived = stated(document, /management fee[^.]*\bwaived\b/i);
      if (waived) effects.push({ kind: 'FEE_WAIVER', economic: true, value: '0', quote: waived.quote });
      const feeRate = waived ? null : stated(document, /management fee[^.]*:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
      if (feeRate) effects.push({ kind: 'FEE_RATE', economic: true, value: number(feeRate.match[1])?.div(100).toString() ?? null, quote: feeRate.quote });
      const carry = stated(document, /carried interest[^.]*:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
      if (carry) effects.push({ kind: 'CARRY_RATE', economic: true, value: number(carry.match[1])?.div(100).toString() ?? null, quote: carry.quote });
      const information = stated(document, /information rights?[^.]*/i);
      if (information) effects.push({ kind: 'INFORMATION_RIGHTS', economic: false, value: null, quote: information.quote });
      const coInvest = stated(document, /co-?investment rights?[^.]*/i);
      if (coInvest) effects.push({ kind: 'CO_INVESTMENT', economic: false, value: null, quote: coInvest.quote });
      return { documentId: document.documentId, investorRef: investor?.match[1] ?? null, heading: document.heading, effects };
    });
}

/** A claim in the round summary or deck that the claims register tracks. */
export interface RoundClaim {
  readonly key: 'ARR' | 'MRR' | 'RUNWAY' | 'NRR' | 'GROSS_MARGIN' | 'CUSTOMERS';
  readonly label: string;
  readonly value: Dec;
  readonly currency: string | null;
  readonly quote: PackRuleQuote;
}

const CLAIM_PATTERNS: readonly { key: RoundClaim['key']; label: string; pattern: RegExp; money: boolean }[] = [
  { key: 'ARR', label: 'ARR', pattern: /\bARR\b[^.:]{0,40}:\s*([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/, money: true },
  { key: 'MRR', label: 'MRR', pattern: /\bMRR\b[^.:]{0,40}:\s*([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/, money: true },
  { key: 'RUNWAY', label: 'Runway', pattern: /\brunway[^.:]{0,40}:\s*()([0-9]{1,3})\s*months/i, money: false },
  { key: 'NRR', label: 'Net revenue retention', pattern: /net (?:revenue|dollar) retention[^.:]{0,20}:\s*()([0-9]{1,3}(?:\.[0-9]+)?)\s*%/i, money: false },
  { key: 'GROSS_MARGIN', label: 'Gross margin', pattern: /gross margin[^.:]{0,20}:\s*()([0-9]{1,3}(?:\.[0-9]+)?)\s*%/i, money: false },
  { key: 'CUSTOMERS', label: 'Paying customers', pattern: /(?:paying )?customers[^.:]{0,20}:\s*()([0-9][0-9,]*)/i, money: false },
];

export function roundClaims(documents: readonly SpvDocument[]): RoundClaim[] {
  const summary = documents.find((document) => document.kind === 'ROUND_SUMMARY');
  return CLAIM_PATTERNS.flatMap(({ key, label, pattern, money: isMoney }) => {
    const hit = stated(summary, pattern);
    const value = number(hit?.match[2]);
    return hit && value ? [{ key, label, value, currency: isMoney ? (hit.match[1] ?? null) : null, quote: hit.quote }] : [];
  });
}
