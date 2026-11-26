import { D, parseDecimal } from '../../metrics/decimal';
import { collapse, sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The fintech payments model (T-159, ADR 0050), deterministic and decimal-only: processed volume,
 * transactions, net revenue and the effective take rate recomputed from the processor or bank
 * exports; chargeback and fraud-loss rates by quarter; the thresholds and claims the documents
 * state, each with its quote; licence and sponsor-agreement status from the register and the
 * documents; and which compliance evidence is on file. Every figure names the rows it rests on.
 * Changing a rule is a new FINTECH_PAYMENTS_VERSION, never a silent edit.
 */
export const FINTECH_PAYMENTS_VERSION = 'fintech-payments-1';
export const PROCESSOR_MONTH = 'fintech.processor_month';
export const LICENCE = 'fintech.licence';
export const LOAN = 'fintech.loan';
export const ALERT = 'fintech.aml_alert';

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;

export interface ProcessorMonth {
  readonly id: string;
  readonly month: string;
  readonly processor: string;
  readonly volume: Decimal;
  readonly transactions: Decimal;
  readonly netRevenue: Decimal;
  readonly chargebacks: Decimal;
  readonly chargebackAmount: Decimal | null;
  readonly fraudLosses: Decimal | null;
}

/** The processor export's rows, by month then processor; a row without a month or a volume is skipped. */
export function processorMonths(evidence: readonly PackRuleEvidence[]): ProcessorMonth[] {
  return evidence
    .filter((row) => row.evidenceType === PROCESSOR_MONTH)
    .flatMap((row) => {
      const month = (row.canonical['month'] ?? '').trim();
      const volume = dec(row.canonical['gross_volume']);
      if (!MONTH.test(month) || !volume) return [];
      return [
        {
          id: row.id,
          month,
          processor: (row.canonical['processor'] ?? '').trim(),
          volume,
          transactions: dec(row.canonical['transactions']) ?? new D(0),
          netRevenue: dec(row.canonical['net_revenue']) ?? new D(0),
          chargebacks: dec(row.canonical['chargeback_count']) ?? new D(0),
          chargebackAmount: dec(row.canonical['chargeback_amount']),
          fraudLosses: dec(row.canonical['fraud_losses']),
        },
      ];
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.processor.localeCompare(b.processor) || a.id.localeCompare(b.id));
}

const previousMonth = (month: string) => {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
};
/** The twelve months ending at `end`, oldest first. */
export const monthsTo = (end: string, length = 12) => {
  const out: string[] = [];
  for (let month = end; out.length < length; month = previousMonth(month)) out.unshift(month);
  return out;
};
/** Last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function lastDayOfMonth(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

export interface VolumeWindow {
  readonly from: string;
  readonly to: string;
  /** Months of the window with no row in the export. */
  readonly missing: readonly string[];
  readonly volume: Decimal;
  readonly transactions: Decimal;
  readonly netRevenue: Decimal;
  /** Net revenue ÷ processed volume. */
  readonly takeRate: Decimal | null;
  readonly rows: readonly ProcessorMonth[];
}

export function volumeWindow(rows: readonly ProcessorMonth[], end: string, length = 12): VolumeWindow {
  const months = monthsTo(end, length);
  const inside = rows.filter((row) => months.includes(row.month));
  const volume = inside.reduce((total, row) => total.plus(row.volume), new D(0));
  const netRevenue = inside.reduce((total, row) => total.plus(row.netRevenue), new D(0));
  return {
    from: months[0] ?? end,
    to: end,
    missing: months.filter((month) => !inside.some((row) => row.month === month)),
    volume,
    transactions: inside.reduce((total, row) => total.plus(row.transactions), new D(0)),
    netRevenue,
    takeRate: volume.gt(0) ? netRevenue.div(volume) : null,
    rows: inside,
  };
}

export interface VolumeModel {
  readonly latestMonth: string | null;
  readonly trailing: VolumeWindow | null;
  readonly prior: VolumeWindow | null;
  /** Trailing ÷ prior processed volume − 1, when both windows are complete. */
  readonly growth: Decimal | null;
  readonly processors: readonly string[];
}

export function volumeModel(rows: readonly ProcessorMonth[]): VolumeModel {
  const latestMonth = rows.at(-1)?.month ?? null;
  if (!latestMonth) return { latestMonth: null, trailing: null, prior: null, growth: null, processors: [] };
  const trailing = volumeWindow(rows, latestMonth);
  const prior = volumeWindow(rows, monthsTo(latestMonth, 13)[0] ?? latestMonth);
  const complete = trailing.missing.length === 0 && prior.missing.length === 0 && prior.volume.gt(0);
  return { latestMonth, trailing, prior: prior.rows.length ? prior : null, growth: complete ? trailing.volume.div(prior.volume).minus(1) : null, processors: [...new Set(rows.map((row) => row.processor))].sort() };
}

export interface QuarterRates {
  /** `2026-Q3`. */
  readonly quarter: string;
  readonly months: readonly string[];
  readonly volume: Decimal;
  readonly transactions: Decimal;
  readonly chargebacks: Decimal;
  /** Chargebacks ÷ transactions (by count). */
  readonly chargebackRate: Decimal | null;
  /** Chargeback amount ÷ volume, when the export carries amounts. */
  readonly chargebackValueRate: Decimal | null;
  readonly fraudLosses: Decimal | null;
  /** Fraud losses ÷ volume, when the export carries them. */
  readonly fraudRate: Decimal | null;
  readonly rows: readonly ProcessorMonth[];
}

/** Calendar quarters with all three months in the export, oldest first. */
export function quarterlyRates(rows: readonly ProcessorMonth[]): QuarterRates[] {
  const quarters = new Map<string, ProcessorMonth[]>();
  for (const row of rows) {
    const [year, month] = row.month.split('-');
    const key = `${year}-Q${Math.ceil(Number(month) / 3)}`;
    quarters.set(key, [...(quarters.get(key) ?? []), row]);
  }
  return [...quarters.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([quarter, inside]) => {
      const months = [...new Set(inside.map((row) => row.month))].sort();
      if (months.length !== 3) return [];
      const volume = inside.reduce((total, row) => total.plus(row.volume), new D(0));
      const transactions = inside.reduce((total, row) => total.plus(row.transactions), new D(0));
      const chargebacks = inside.reduce((total, row) => total.plus(row.chargebacks), new D(0));
      const amounts = inside.every((row) => row.chargebackAmount !== null) ? inside.reduce((total, row) => total.plus(row.chargebackAmount ?? 0), new D(0)) : null;
      const fraud = inside.every((row) => row.fraudLosses !== null) ? inside.reduce((total, row) => total.plus(row.fraudLosses ?? 0), new D(0)) : null;
      return [
        {
          quarter,
          months,
          volume,
          transactions,
          chargebacks,
          chargebackRate: transactions.gt(0) ? chargebacks.div(transactions) : null,
          chargebackValueRate: amounts && volume.gt(0) ? amounts.div(volume) : null,
          fraudLosses: fraud,
          fraudRate: fraud && volume.gt(0) ? fraud.div(volume) : null,
          rows: inside,
        },
      ];
    });
}

// ------------------------------------------------------------------ what the documents state

export interface StatedThreshold {
  readonly measure: 'CHARGEBACK' | 'FRAUD';
  /** As a fraction (0.009 for 0.90%). */
  readonly limit: Decimal;
  /** COUNT: per settled transaction; VOLUME: per unit of processed volume. */
  readonly basis: 'COUNT' | 'VOLUME';
  /** True for "below / under / less than": reaching the limit is a breach; otherwise only exceeding it is. */
  readonly strict: boolean;
  readonly quote: PackRuleQuote;
}

const LIMIT = /\b(?:not exceed|no more than|at most|below|under|less than|maximum of|exceed)\b/i;
const STRICT = /\b(?:below|under|less than)\b/i;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/;
const cap = (text: string) => (text.length > 400 ? text.slice(0, 400) : text);

/** The chargeback and fraud-loss thresholds the documents themselves state (a sponsor covenant, a network program), first of each. */
export function statedThresholds(pages: readonly PackRulePage[]): StatedThreshold[] {
  const found: StatedThreshold[] = [];
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const measure = /chargeback/i.test(sentence) ? 'CHARGEBACK' : /fraud loss/i.test(sentence) ? 'FRAUD' : null;
      const percent = PERCENT.exec(sentence);
      if (!measure || !percent || !LIMIT.test(sentence) || found.some((entry) => entry.measure === measure)) continue;
      const byVolume = measure === 'FRAUD' || /\b(?:by (?:value|amount|volume)|of (?:processed |settled )?volume)\b/i.test(sentence);
      found.push({
        measure,
        limit: new D(percent[1] ?? '0').div(100),
        basis: byVolume ? 'VOLUME' : 'COUNT',
        strict: STRICT.test(sentence),
        quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) },
      });
    }
  }
  return found;
}

export type PaymentClaimKey = 'TPV' | 'TPV_GROWTH' | 'TAKE_RATE' | 'RETENTION';
export interface PaymentClaim {
  readonly key: PaymentClaimKey;
  readonly label: string;
  /** Money for TPV; a percentage (48 for 48%) otherwise. */
  readonly value: Decimal;
  readonly currency: string | null;
  /** The month a TPV claim runs to, when the sentence names one ("twelve months to September 2026"). */
  readonly month: string | null;
  readonly quote: PackRuleQuote;
}

const CLAIM_LABELS: Readonly<Record<PaymentClaimKey, string>> = {
  TPV: 'Total payment volume',
  TPV_GROWTH: 'TPV growth',
  TAKE_RATE: 'Take rate',
  RETENTION: 'Retention',
};
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NAMED_MONTH = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/;
const MONEY = /\b([A-Z]{3})\s?([0-9][0-9,]*(?:\.[0-9]+)?)/;
const TPV = /\b(?:total payment volume|TPV)\b/i;

/** The payment claims a deck or memorandum states: TPV, its growth, the take rate and retention, first of each. */
export function paymentClaims(pages: readonly PackRulePage[]): PaymentClaim[] {
  const found = new Map<PaymentClaimKey, PaymentClaim>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const quote = { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) };
      const percent = PERCENT.exec(sentence);
      const named = NAMED_MONTH.exec(sentence);
      const month = named ? `${named[2]}-${String(MONTH_NAMES.indexOf((named[1] ?? '').toLowerCase()) + 1).padStart(2, '0')}` : null;
      const add = (key: PaymentClaimKey, value: Decimal | null, currency: string | null) => {
        if (value && !found.has(key)) found.set(key, { key, label: CLAIM_LABELS[key], value, currency, month: key === 'TPV' ? month : null, quote });
      };
      if (/\btake rate\b/i.test(sentence) && percent) add('TAKE_RATE', new D(percent[1] ?? '0'), null);
      else if (/\b(?:net revenue retention|merchant retention|NRR|retention)\b/i.test(sentence) && percent) add('RETENTION', new D(percent[1] ?? '0'), null);
      else if (TPV.test(sentence) && percent && /\b(?:grew|growth|up|increase)\b/i.test(sentence)) add('TPV_GROWTH', new D(percent[1] ?? '0'), null);
      else if (TPV.test(sentence) && !percent) {
        const money = MONEY.exec(sentence);
        if (money) add('TPV', dec(money[2]), money[1] ?? null);
      }
    }
  }
  return [...found.values()];
}

// ------------------------------------------------------------------ licences and sponsor agreements

export interface LicenceRow {
  readonly id: string;
  readonly licenceId: string;
  readonly kind: string;
  readonly jurisdiction: string;
  readonly authority: string;
  readonly status: string;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function licenceRows(evidence: readonly PackRuleEvidence[]): LicenceRow[] {
  return evidence
    .filter((row) => row.evidenceType === LICENCE)
    .map((row) => {
      const date = (field: string) => {
        const value = (row.canonical[field] ?? '').trim();
        return ISO_DATE.test(value) ? value : null;
      };
      return {
        id: row.id,
        licenceId: (row.canonical['licence_id'] ?? '').trim(),
        kind: (row.canonical['kind'] ?? '').trim().toLowerCase(),
        jurisdiction: (row.canonical['jurisdiction'] ?? '').trim(),
        authority: (row.canonical['authority'] ?? '').trim(),
        status: (row.canonical['status'] ?? '').trim().toLowerCase(),
        issuedOn: date('issued_on'),
        expiresOn: date('expires_on'),
      };
    })
    .filter((row) => row.licenceId)
    .sort((a, b) => a.licenceId.localeCompare(b.licenceId));
}

const DAY_MONTH_YEAR = /\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/i;
const MONTH_DAY_YEAR = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/i;
const ISO_IN_TEXT = /\b(\d{4}-\d{2}-\d{2})\b/;
/** A date written in a sentence: "31 May 2026", "May 31, 2026" or "2026-05-31". */
export function dateIn(text: string): string | null {
  const iso = ISO_IN_TEXT.exec(text);
  if (iso) return iso[1] ?? null;
  const pad = (month: string, day: string) => `${String(MONTH_NAMES.indexOf(month.toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
  const dmy = DAY_MONTH_YEAR.exec(text);
  if (dmy) return `${dmy[3]}-${pad(dmy[2] ?? '', dmy[1] ?? '')}`;
  const mdy = MONTH_DAY_YEAR.exec(text);
  return mdy ? `${mdy[3]}-${pad(mdy[1] ?? '', mdy[2] ?? '')}` : null;
}

/** "expires", "expired", "expiry", never a column name such as `expires_on`. */
const EXPIRY_WORD = /\bexpir(?:es|ed|e|y|ing)\b/i;

/**
 * The expiry a document states for a licence or agreement id: one sentence that names the id and says
 * when it expires ("Licence number MT-1 … expires on 31 May 2026"). The date read is the one after the
 * word, since a sentence may give the issue date first.
 */
export function documentExpiry(pages: readonly PackRulePage[], licenceId: string): { date: string; quote: PackRuleQuote } | null {
  if (!licenceId) return null;
  const id = licenceId.toLowerCase();
  for (const page of pages) {
    if (!collapse(page.text).toLowerCase().includes(id)) continue;
    for (const sentence of sentences(page.text)) {
      if (!sentence.toLowerCase().includes(id)) continue;
      const at = sentence.search(EXPIRY_WORD);
      const date = at >= 0 ? dateIn(sentence.slice(at)) : null;
      if (date) return { date, quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) } };
    }
  }
  return null;
}

/** Days within which a licence or agreement expiring after the analysis date is a near expiry. */
export const NEAR_EXPIRY_DAYS = 90;
export type LicenceState = 'LAPSED' | 'NEAR_EXPIRY' | 'PENDING' | 'ACTIVE' | 'NO_EXPIRY';
export interface LicenceStatus {
  readonly row: LicenceRow;
  readonly state: LicenceState;
  /** The expiry that governs: the document's when it states one, else the register's. */
  readonly expiresOn: string | null;
  readonly document: { date: string; quote: PackRuleQuote } | null;
  /** The register's date differs from the document's. */
  readonly registerDiffers: boolean;
  /** Whole days from expiry to the analysis date (positive: expired that long ago). */
  readonly daysPastExpiry: number | null;
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Each register row's state at the analysis date (the end of the latest processor month); null date reads register statuses only. */
export function licenceStatuses(rows: readonly LicenceRow[], pages: readonly PackRulePage[], asOf: string | null): LicenceStatus[] {
  return rows.map((row) => {
    const document = documentExpiry(pages, row.licenceId);
    const expiresOn = document?.date ?? row.expiresOn;
    const daysPastExpiry = expiresOn && asOf ? days(expiresOn, asOf) : null;
    const lapsedByRegister = ['lapsed', 'surrendered', 'revoked'].includes(row.status);
    const state: LicenceState =
      lapsedByRegister || (daysPastExpiry !== null && daysPastExpiry > 0)
        ? 'LAPSED'
        : daysPastExpiry !== null && -daysPastExpiry <= NEAR_EXPIRY_DAYS
          ? 'NEAR_EXPIRY'
          : row.status === 'pending'
            ? 'PENDING'
            : expiresOn
              ? 'ACTIVE'
              : 'NO_EXPIRY';
    return { row, state, expiresOn, document, registerDiffers: Boolean(document && row.expiresOn && document.date !== row.expiresOn), daysPastExpiry };
  });
}

/** The analysis date: the last day of the latest processor month; null with no export. */
export function fintechAnalysisDate(rows: readonly ProcessorMonth[]): string | null {
  const latest = rows.at(-1)?.month;
  return latest ? lastDayOfMonth(latest) : null;
}

// ------------------------------------------------------------------ compliance evidence

export type ComplianceKind = 'PCI_ATTESTATION' | 'AML_PROGRAM' | 'REGULATORY_EXAM';
export interface ComplianceDocument {
  readonly kind: ComplianceKind;
  readonly documentId: string;
  /** The heading it was recognised by. */
  readonly quote: PackRuleQuote;
  /** The date it states (an attestation date, an exam date), when it states one. */
  readonly date: string | null;
  /** An exam document that is, or records, a consent order. */
  readonly consentOrder: boolean;
}

const HEADINGS: readonly [ComplianceKind, RegExp][] = [
  ['PCI_ATTESTATION', /\b(?:attestation of compliance|PCI DSS)\b/i],
  ['AML_PROGRAM', /\b(?:BSA\/AML|KYC\/AML|anti-money[- ]laundering|AML) (?:programme|program)\b/i],
  ['REGULATORY_EXAM', /\b(?:report of examination|examination report|consent order|matters requiring attention)\b/i],
];

/** Compliance documents recognised by the heading on their first page; one per kind and document. */
export function complianceDocuments(pages: readonly PackRulePage[]): ComplianceDocument[] {
  const firstPages = new Map<string, PackRulePage>();
  for (const page of pages) {
    const seen = firstPages.get(page.documentId);
    if (!seen || page.pageNumber < seen.pageNumber) firstPages.set(page.documentId, page);
  }
  const found: ComplianceDocument[] = [];
  for (const page of [...firstPages.values()].sort((a, b) => a.documentId.localeCompare(b.documentId))) {
    const heading = sentences(page.text)[0] ?? '';
    const kind = HEADINGS.find(([, pattern]) => pattern.test(heading))?.[0];
    if (!kind) continue;
    const dated = sentences(page.text).find((sentence) => /\b(?:date of attestation|attested on|dated|examination date|as of)\b/i.test(sentence) && dateIn(sentence));
    found.push({
      kind,
      documentId: page.documentId,
      quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(heading) },
      date: dated ? dateIn(dated) : null,
      consentOrder: kind === 'REGULATORY_EXAM' && /\bconsent order\b/i.test(heading),
    });
  }
  return found;
}

/** A PCI attestation older than this many days at the analysis date is stale (attestations are annual). */
export const PCI_STALE_DAYS = 365;
