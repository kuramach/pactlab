import { D, parseDecimal } from '../../metrics/decimal';
import { effectiveTerms, liquidationPreference, type CapTableRow, type HolderType, type Instrument } from '../../venture/round';
import { amountOf, grouped, INVOICE_LINE, latestMonthRevenue, monthName, percent } from '../common';
import { findMatch, findSentence, MAX_CITED, sentences, type PackRule, type PackRuleEvidence, type PackRulePage } from '../rule-types';

/**
 * Venture Raise pack rules (T-083, founder-side). Drags (−1) are what an
 * investor will find and price; cushions (+1) are confirmed value the founder
 * keeps confidential until they choose to show it; neutral (0) term notes
 * explain consequences. Never legal advice. Holders are pseudonymous.
 */
const CAP_TABLE = 'venture.cap_table_row';
const FINANCIALS = 'venture.financials_month';
type Dec = InstanceType<typeof D>;

const capRows = (evidence: readonly PackRuleEvidence[]) => evidence.filter((row) => row.evidenceType === CAP_TABLE);
const yes = (value: string | null | undefined) => ['yes', 'true', 'y', '1'].includes((value ?? '').toLowerCase());

/** Cap-table evidence as the round model reads it. */
export function capTableOf(evidence: readonly PackRuleEvidence[]): CapTableRow[] {
  return capRows(evidence).map((row) => ({
    securityId: row.canonical['security_id'] ?? row.sourceRecordId,
    holderRef: row.canonical['holder_ref'] ?? '',
    holderType: (row.canonical['holder_type'] ?? 'investor') as HolderType,
    instrument: (row.canonical['instrument'] ?? 'common') as Instrument,
    shares: parseDecimal(row.canonical['shares']),
    principal: parseDecimal(row.canonical['principal']),
    valuationCap: parseDecimal(row.canonical['valuation_cap']),
    discount: parseDecimal(row.canonical['discount_pct'])?.div(100) ?? null,
    mfn: yes(row.canonical['mfn']),
    issuedOn: row.canonical['issued_on'] ?? null,
  }));
}

const deckPages = (pages: readonly PackRulePage[]) => {
  const decks = new Set(pages.filter((page) => /investor deck|pitch deck/i.test(page.text)).map((page) => page.documentId));
  return pages.filter((page) => decks.has(page.documentId));
};

/** Billed MRR in the latest month: each line normalized to a month by its billing interval. */
export function billedMrr(evidence: readonly PackRuleEvidence[]) {
  const revenue = latestMonthRevenue(evidence);
  if (!revenue) return null;
  const monthly = revenue.lines.reduce((sum, row) => {
    const months = row.canonical['interval'] === 'year' ? 12 : 1;
    const count = parseDecimal(row.canonical['interval_count']) ?? new D(1);
    return sum.plus(amountOf(row, 'amount').div(count.times(months)));
  }, new D(0));
  return { month: revenue.month, currency: revenue.currency, mrr: monthly, lines: revenue.lines };
}

const DECK_METRIC = /\b(ARR|MRR)\b[^.:]{0,60}:\s*([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/;

/**
 * The deck's ARR or MRR against billing: more than 2% apart is a
 * contradicted claim (−1, the credibility killer); within 0.5% is a verified
 * claim (+1, confirmed value).
 */
export const VENTURE_DECK_METRIC: PackRule = {
  id: 'venture-deck-metric',
  version: '1',
  evidenceTypes: [INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const billed = billedMrr(evidence);
    const hit = findMatch(deckPages(pages), DECK_METRIC);
    if (!billed || !hit) return [];
    const [, metric = 'ARR', currency = '', raw = ''] = hit.match;
    const stated = parseDecimal(raw.replaceAll(',', ''));
    if (!stated || currency !== billed.currency || !billed.mrr.gt(0)) return [];
    const actual = metric === 'ARR' ? billed.mrr.times(12) : billed.mrr;
    const gap = stated.minus(actual).div(actual);
    const evidenceIds = billed.lines.slice(0, MAX_CITED).map((row) => row.id);
    const quotes = [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }];
    const basis = `billing gives ${currency} ${grouped(actual)} ${metric} for ${monthName(billed.month)} (MRR ${currency} ${grouped(billed.mrr)}, each line normalized to a month)`;
    if (gap.abs().gt('0.02'))
      return [
        {
          key: `${metric}:contradicted`,
          domain: 'FINANCIAL',
          title: `Deck ${metric} contradicted by billing`,
          description: `The deck states ${metric} of ${currency} ${grouped(stated)}; ${basis} — the deck is ${percent(gap.abs())} ${gap.gt(0) ? 'higher' : 'lower'}. Investors check this first; correct the deck before they do.`,
          severity: 'HIGH',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'A contradicted headline metric costs credibility and price; the round should rest on billed revenue.',
          evidenceIds,
          quotes,
          claim: { statement: hit.quote, status: 'CONTRADICTED', rationale: `Billing: ${basis}.` },
        },
      ];
    if (gap.abs().lte('0.005'))
      return [
        {
          key: `${metric}:ties`,
          domain: 'FINANCIAL',
          title: `Deck ${metric} ties to billing`,
          description: `The deck's ${metric} of ${currency} ${grouped(stated)} matches billing: ${basis}. Confirmed value — yours to show when you choose.`,
          severity: 'LOW',
          confidence: 'HIGH',
          direction: 1,
          valueConfirmation: { valueDriver: `Deck ${metric} verified against billing`, impliedValue: null, basis: `Billing: ${basis}.` },
          evidenceIds,
          quotes,
          claim: { statement: hit.quote, status: 'VERIFIED', rationale: `Billing: ${basis}.` },
        },
      ];
    return [];
  },
};

const IP_ASSIGNMENT = (sentence: string) => /\bassign/i.test(sentence) && /(intellectual property|inventions?|work product)/i.test(sentence);
const CONTRACTOR = /contractor agreement|consulting agreement|independent contractor/i;

/**
 * Contractor and consulting agreements without a sentence assigning IP to the
 * company (−1 each), or every one of them assigning it (+1). Only agreements
 * in the data room are read; a missing agreement is a readiness gap.
 */
export const VENTURE_IP_ASSIGNMENT: PackRule = {
  id: 'venture-ip-assignment',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const agreements = [...new Set(pages.filter((page) => page.pageNumber === 1 && CONTRACTOR.test(page.text)).map((page) => page.documentId))];
    if (agreements.length === 0) return [];
    const ofDocument = (id: string) => pages.filter((page) => page.documentId === id);
    const gaps = agreements.filter((id) => !findSentence(ofDocument(id), IP_ASSIGNMENT));
    const title = (id: string) => {
      const page = ofDocument(id)[0] as PackRulePage;
      return { page, quote: (sentences(page.text)[0] ?? page.text).slice(0, 200) };
    };
    if (gaps.length === 0)
      return [
        {
          key: 'ip-chain-complete',
          domain: 'LEGAL',
          title: 'IP assignment chain complete',
          description: `All ${agreements.length} contractor and consulting agreements in the data room assign their work to the company.`,
          severity: 'LOW',
          confidence: 'MEDIUM',
          direction: 1,
          valueConfirmation: { valueDriver: 'IP owned by the company', impliedValue: null, basis: 'Every contractor agreement carries an assignment sentence.' },
          evidenceIds: [],
          quotes: agreements.slice(0, 10).map((id) => {
            const hit = findSentence(ofDocument(id), IP_ASSIGNMENT);
            return { documentId: id, pageNumber: hit?.page.pageNumber ?? 1, quote: hit?.quote ?? '' };
          }),
        },
      ];
    return gaps.map((id) => {
      const { page, quote } = title(id);
      return {
        key: `ip-gap:${id}`,
        domain: 'LEGAL' as const,
        title: 'IP assignment gap',
        description: `This agreement has no sentence assigning the contractor's work, inventions or intellectual property to the company: “${quote}” Investors' counsel will ask for a confirmatory assignment; obtain one before they do.`,
        severity: 'HIGH' as const,
        confidence: 'MEDIUM' as const,
        direction: -1 as const,
        directionRationale: 'IP the company may not own is a closing condition or a price term in every institutional round.',
        evidenceIds: [],
        quotes: [{ documentId: page.documentId, pageNumber: page.pageNumber, quote }],
      };
    });
  },
};

const ISSUED = /issued and outstanding:?\s*([0-9][0-9,]*)\s*shares/i;

/** Issued shares in the cap table (common and preferred) against the corporate record: reconciles (+1) or not (−1). */
export const VENTURE_CAP_TABLE_RECORD: PackRule = {
  id: 'venture-cap-table-record',
  version: '1',
  evidenceTypes: [CAP_TABLE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = capRows(evidence).filter((row) => ['common', 'preferred'].includes(row.canonical['instrument'] ?? ''));
    const hit = findMatch(pages, ISSUED);
    const recorded = hit ? parseDecimal((hit.match[1] ?? '').replaceAll(',', '')) : null;
    if (rows.length === 0 || !hit || !recorded) return [];
    const issued = rows.reduce((sum, row) => sum.plus(amountOf(row, 'shares')), new D(0));
    const quotes = [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }];
    const evidenceIds = rows.slice(0, MAX_CITED).map((row) => row.id);
    if (issued.eq(recorded))
      return [
        {
          key: 'reconciles',
          domain: 'LEGAL',
          title: 'Cap table reconciles to the corporate record',
          description: `The cap table's ${grouped(issued)} issued shares match the ${grouped(recorded)} the corporate record states, to the share.`,
          severity: 'LOW',
          confidence: 'HIGH',
          direction: 1,
          valueConfirmation: { valueDriver: 'Clean capitalization', impliedValue: null, basis: 'Issued shares match the corporate record exactly.' },
          evidenceIds,
          quotes,
        },
      ];
    return [
      {
        key: 'mismatch',
        domain: 'LEGAL',
        title: 'Cap table does not reconcile to the corporate record',
        description: `The cap table shows ${grouped(issued)} issued shares; the corporate record states ${grouped(recorded)} — ${grouped(issued.minus(recorded).abs())} apart. Investors will not close on an unreconciled cap table.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'An unreconciled cap table delays closing and invites a price or escrow term.',
        evidenceIds,
        quotes,
      },
    ];
  },
};

const SAFE_TOTAL = /SAFEs?[^.:]{0,40}(?:outstanding|raised)[^.:]{0,20}:\s*([A-Z]{3})\s*([0-9][0-9,]*)/i;

/** The SAFE and note stack: a total the deck understates, or an MFN clause a later instrument triggers (−1). */
export const VENTURE_SAFE_STACK: PackRule = {
  id: 'venture-safe-stack',
  version: '1',
  evidenceTypes: [CAP_TABLE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = capRows(evidence).filter((row) => ['safe', 'note'].includes(row.canonical['instrument'] ?? ''));
    if (rows.length === 0) return [];
    const total = rows.reduce((sum, row) => sum.plus(amountOf(row, 'principal')), new D(0));
    const triggered = effectiveTerms(capTableOf(evidence)).filter((entry) => entry.mfnFrom);
    const hit = findMatch(deckPages(pages), SAFE_TOTAL);
    const stated = hit ? parseDecimal((hit.match[2] ?? '').replaceAll(',', '')) : null;
    const understated = stated !== null && stated.lt(total);
    if (triggered.length === 0 && !understated) return [];
    const parts = [
      ...(understated && stated ? [`the deck states ${grouped(stated)} outstanding; the cap table holds ${grouped(total)} across ${rows.length} instruments`] : []),
      ...triggered.map((entry) => `${entry.row.securityId} has a most-favoured-nation clause, so it takes ${entry.mfnFrom}'s ${entry.cap ? `cap of ${grouped(entry.cap)}` : 'better terms'}`),
    ];
    return [
      {
        key: `stack:${triggered.map((entry) => entry.row.securityId).join(',')}:${understated}`,
        domain: 'FINANCIAL',
        title: 'SAFE stack converts into more than expected',
        description: `${parts.join('; ')}. The stack converts into more of the company than the founders' plan assumes — see the round model for the shares.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'More conversion shares mean more founder dilution at any price; the round model shows how much.',
        evidenceIds: rows.slice(0, MAX_CITED).map((row) => row.id),
        quotes: hit && understated ? [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }] : [],
      },
    ];
  },
};

const RUNWAY = /runway[^.:]{0,40}:\s*([0-9]{1,3})\s*months/i;

/** Runway from cash and average net burn (last three months) against the runway the deck states (−1 when two or more months short). */
export const VENTURE_RUNWAY_SHORT: PackRule = {
  id: 'venture-runway-short',
  version: '1',
  evidenceTypes: [FINANCIALS],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const months = evidence
      .filter((row) => row.evidenceType === FINANCIALS && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''))
      .sort((a, b) => (a.canonical['month'] ?? '').localeCompare(b.canonical['month'] ?? ''));
    const hit = findMatch(deckPages(pages), RUNWAY);
    const latest = months.at(-1);
    if (!latest || !hit || months.length < 3) return [];
    const recent = months.slice(-3);
    const burn = recent.reduce((sum, row) => sum.plus(amountOf(row, 'net_burn')), new D(0)).div(recent.length);
    if (!burn.gt(0)) return [];
    const runway: Dec = amountOf(latest, 'cash_balance').div(burn);
    const stated = new D(hit.match[1] ?? '0');
    if (stated.minus(runway).lt(2)) return [];
    const statement = `Cash of ${grouped(amountOf(latest, 'cash_balance'))} at ${monthName(latest.canonical['month'] ?? '')} over an average net burn of ${grouped(burn)} (last three months) is ${runway.toFixed(1)} months`;
    return [
      {
        key: `${latest.canonical['month']}`,
        domain: 'FINANCIAL',
        title: 'Runway shorter than the deck says',
        description: `The deck states ${stated.toString()} months of runway. ${statement} — ${stated.minus(runway).toFixed(1)} months less. Investors read a short runway as leverage; raise with time to spare or say it plainly.`,
        severity: stated.minus(runway).gte(6) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Less runway than stated weakens the founder’s position on price and terms.',
        evidenceIds: recent.map((row) => row.id),
        quotes: [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }],
        claim: { statement: hit.quote, status: 'CONTRADICTED', rationale: `${statement}.` },
      },
    ];
  },
};

/** Founders holding vesting stock whom the 83(b) confirmations do not name (−1). Only read when confirmations are in the data room. */
export const VENTURE_MISSING_83B: PackRule = {
  id: 'venture-missing-83b',
  version: '1',
  evidenceTypes: [CAP_TABLE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    // Whole documents that are 83(b) confirmations: the holders are often named on later pages.
    const documents = new Set(pages.filter((page) => /83\s*\(b\)/i.test(page.text)).map((page) => page.documentId));
    const confirmations = pages.filter((page) => documents.has(page.documentId));
    if (confirmations.length === 0) return [];
    const founders = capRows(evidence).filter((row) => row.canonical['holder_type'] === 'founder' && yes(row.canonical['vesting']));
    const named = (ref: string) => confirmations.some((page) => new RegExp(`\\b${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(page.text));
    const missing = founders.filter((row) => !named(row.canonical['holder_ref'] ?? ''));
    if (missing.length === 0) return [];
    return [
      {
        key: missing.map((row) => row.canonical['holder_ref']).sort().join(','),
        domain: 'LEGAL',
        title: 'Founder 83(b) confirmation missing',
        description: `${missing.map((row) => row.canonical['holder_ref']).join(', ')} hold vesting founder stock, and the 83(b) confirmations in the data room do not name them. Find the filing receipts; a missing election cannot be fixed later.`,
        severity: 'HIGH',
        confidence: 'MEDIUM',
        direction: -1,
        directionRationale: 'A missing 83(b) election is a tax exposure that investors’ counsel flags at closing.',
        evidenceIds: missing.map((row) => row.id),
      },
    ];
  },
};

/** The largest customer at a quarter or more of revenue, with nothing in the deck about it (−1). */
export const VENTURE_UNDISCLOSED_CONCENTRATION: PackRule = {
  id: 'venture-undisclosed-concentration',
  version: '1',
  evidenceTypes: [INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const revenue = latestMonthRevenue(evidence);
    const deck = deckPages(pages);
    const [name, amount] = revenue?.ranked[0] ?? [];
    if (!revenue || !name || !amount || deck.length === 0) return [];
    const share = amount.div(revenue.total);
    if (share.lt('0.25') || findSentence(deck, (sentence) => /concentrat|largest customer|top customer/i.test(sentence))) return [];
    return [
      {
        key: `${revenue.month}:${name}`,
        domain: 'COMMERCIAL',
        title: 'Customer concentration the deck does not disclose',
        description: `${name} is ${percent(share)} of ${monthName(revenue.month)} revenue, and the deck says nothing about customer concentration. Disclose it before diligence finds it.`,
        severity: share.gte('0.4') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Undisclosed concentration found in diligence costs more than the same fact disclosed up front.',
        evidenceIds: revenue.linesOf([name]).slice(0, MAX_CITED).map((row) => row.id),
      },
    ];
  },
};

const PREFERENCE = /liquidation preference[^.]{0,60}?(\d+(?:\.\d+)?)\s*x\s*(non-participating|participating)?/i;

/** Term-sheet mechanics as plain consequences (0): a preference other than 1x non-participating, and board composition. */
export const VENTURE_TERM_VARIANCE: PackRule = {
  id: 'venture-term-variance',
  version: '1',
  evidenceTypes: [],
  readsDocuments: true,
  detect: ({ pages }) => {
    const sheets = new Set(pages.filter((page) => /term sheet/i.test(page.text)).map((page) => page.documentId));
    const sheet = pages.filter((page) => sheets.has(page.documentId));
    if (sheet.length === 0) return [];
    const out = [];
    const preference = findMatch(sheet, PREFERENCE);
    if (preference) {
      const terms = liquidationPreference(new D(preference.match[1] ?? '1'), (preference.match[2] ?? '').toLowerCase() === 'participating');
      if (!terms.standard)
        out.push({
          key: `preference:${preference.page.documentId}`,
          domain: 'LEGAL' as const,
          title: 'Liquidation preference above the baseline',
          description: `${terms.statement} The term sheet: “${preference.quote}”`,
          severity: 'MEDIUM' as const,
          confidence: 'HIGH' as const,
          direction: 0 as const,
          directionRationale: 'A term to understand and negotiate, not a price adjustment; Pactlab shows what it does, not whether to accept it.',
          evidenceIds: [],
          quotes: [{ documentId: preference.page.documentId, pageNumber: preference.page.pageNumber, quote: preference.quote }],
        });
    }
    const board = findSentence(sheet, (sentence) => /\bboard\b/i.test(sentence) && /director/i.test(sentence));
    if (board)
      out.push({
        key: `board:${board.page.documentId}`,
        domain: 'LEGAL' as const,
        title: 'Board composition after the round',
        description: `After closing the board is: “${board.quote}” Board seats decide who controls hiring, budgets and the next raise; count where the majority sits.`,
        severity: 'LOW' as const,
        confidence: 'HIGH' as const,
        direction: 0 as const,
        directionRationale: 'Governance consequence for the founder to weigh; not a price term.',
        evidenceIds: [],
        quotes: [{ documentId: board.page.documentId, pageNumber: board.page.pageNumber, quote: board.quote }],
      });
    return out;
  },
};

export const VENTURE_RULES: readonly PackRule[] = [
  VENTURE_DECK_METRIC,
  VENTURE_IP_ASSIGNMENT,
  VENTURE_CAP_TABLE_RECORD,
  VENTURE_SAFE_STACK,
  VENTURE_RUNWAY_SHORT,
  VENTURE_MISSING_83B,
  VENTURE_UNDISCLOSED_CONCENTRATION,
  VENTURE_TERM_VARIANCE,
];
export const VENTURE_EVIDENCE = { CAP_TABLE, FINANCIALS } as const;
