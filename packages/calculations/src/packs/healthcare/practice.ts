import { D, parseDecimal } from '../../metrics/decimal';
import { dateIn, lastDayOfMonth, monthsTo } from '../fintech/payments';
import { collapse, sentences, type PackRuleEvidence, type PackRulePage, type PackRuleQuote } from '../rule-types';

/**
 * The healthcare services practice model (T-160, ADR 0051), deterministic and decimal-only: charges
 * billed, cash collected, claims and denials by payer and payer class recomputed from the remittance
 * export, by calendar year and for the trailing twelve months; days in accounts receivable at each
 * year end; collections by clinician; each clinician's licences and credentials at the analysis date,
 * with dates from the verification documents where they state them; the payer contract register; the
 * claims the documents make; and which compliance evidence is on file. Every figure names the rows it
 * rests on. Dates and arithmetic only: never the quality of care or whether anything is lawful.
 * Changing a rule is a new HEALTHCARE_COLLECTIONS_VERSION, never a silent edit.
 */
export const HEALTHCARE_COLLECTIONS_VERSION = 'healthcare-collections-1';
export const REMITTANCE = 'healthcare.remittance_month';
export const CLINICIAN_MONTH = 'healthcare.clinician_month';
export const CREDENTIAL = 'healthcare.credential';
export const PAYER_CONTRACT = 'healthcare.payer_contract';
export const ROSTER = 'healthcare.provider';

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dec = (value: string | null | undefined) => parseDecimal((value ?? '').replaceAll(',', '').trim()) ?? null;
const text = (row: PackRuleEvidence, field: string) => (row.canonical[field] ?? '').trim();
const dateOf = (row: PackRuleEvidence, field: string) => (ISO_DATE.test(text(row, field)) ? text(row, field) : null);
const cap = (value: string) => (value.length > 400 ? value.slice(0, 400) : value);
const sum = <T>(items: readonly T[], of: (item: T) => Decimal) => items.reduce((total, item) => total.plus(of(item)), new D(0));
const ratio = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole) : null);

export const PAYER_CLASSES = ['commercial', 'medicare', 'medicaid', 'other_government', 'self_pay'] as const;
export type PayerClass = (typeof PAYER_CLASSES)[number];
export const PAYER_CLASS_LABELS: Readonly<Record<PayerClass, string>> = {
  commercial: 'Commercial',
  medicare: 'Medicare',
  medicaid: 'Medicaid',
  other_government: 'Other government',
  self_pay: 'Self-pay',
};
/** The classes a "government" claim covers. */
export const GOVERNMENT_CLASSES: readonly PayerClass[] = ['medicare', 'medicaid', 'other_government'];
const classOf = (value: string): PayerClass | null => (PAYER_CLASSES as readonly string[]).includes(value) ? (value as PayerClass) : null;

// ------------------------------------------------------------------ remittances

export interface RemittanceMonth {
  readonly id: string;
  readonly month: string;
  readonly payer: string;
  readonly payerClass: PayerClass;
  readonly claims: Decimal;
  readonly denied: Decimal;
  readonly billed: Decimal;
  readonly collected: Decimal;
  /** Receivables open at month end; null when the export leaves it blank. */
  readonly ar: Decimal | null;
}

/** The remittance export's rows, by month then payer; a row without a month, a payer class or the amounts is skipped. */
export function remittanceMonths(evidence: readonly PackRuleEvidence[]): RemittanceMonth[] {
  return evidence
    .filter((row) => row.evidenceType === REMITTANCE)
    .flatMap((row) => {
      const month = text(row, 'month');
      const payerClass = classOf(text(row, 'payer_class').toLowerCase());
      const billed = dec(row.canonical['billed']);
      const collected = dec(row.canonical['collected']);
      if (!MONTH.test(month) || !payerClass || !billed || !collected) return [];
      return [{ id: row.id, month, payer: text(row, 'payer'), payerClass, claims: dec(row.canonical['claims']) ?? new D(0), denied: dec(row.canonical['denied_claims']) ?? new D(0), billed, collected, ar: dec(row.canonical['ar_balance']) }];
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.payer.localeCompare(b.payer) || a.id.localeCompare(b.id));
}

/** The analysis date: the last day of the latest remittance month; null with no export. */
export function healthcareAnalysisDate(rows: readonly RemittanceMonth[]): string | null {
  const latest = rows.at(-1)?.month;
  return latest ? lastDayOfMonth(latest) : null;
}

export interface ClassShare {
  readonly payerClass: PayerClass;
  readonly collected: Decimal;
  readonly claims: Decimal;
  /** Share of the period's collections. */
  readonly share: Decimal | null;
  /** Share of the period's claims. */
  readonly claimShare: Decimal | null;
  /** Collected per claim: what this class pays on average. */
  readonly yieldPerClaim: Decimal | null;
}

export interface CollectionsPeriod {
  /** A calendar year (`2025`) or the trailing window (`2025-10 to 2026-09`). */
  readonly label: string;
  readonly from: string;
  readonly to: string;
  /** Months of the period with no row in the export. */
  readonly missing: readonly string[];
  readonly claims: Decimal;
  readonly denied: Decimal;
  readonly billed: Decimal;
  readonly collected: Decimal;
  /** Denied ÷ adjudicated claims. */
  readonly denialRate: Decimal | null;
  /** Collected ÷ charges billed (the gross collection rate). */
  readonly collectionRate: Decimal | null;
  /** Receivables open at the period's last month end. */
  readonly arAtEnd: Decimal | null;
  /** Receivables at the period's end ÷ (charges billed in the period ÷ 365). */
  readonly daysInAr: Decimal | null;
  readonly byClass: readonly ClassShare[];
  readonly rows: readonly RemittanceMonth[];
}

/** One period's collections over the months `months`, oldest first. */
export function collectionsPeriod(rows: readonly RemittanceMonth[], months: readonly string[], label: string): CollectionsPeriod {
  const inside = rows.filter((row) => months.includes(row.month));
  const last = months.at(-1) ?? '';
  const claims = sum(inside, (row) => row.claims);
  const collected = sum(inside, (row) => row.collected);
  const billed = sum(inside, (row) => row.billed);
  const atEnd = inside.filter((row) => row.month === last);
  const arAtEnd = atEnd.length && atEnd.every((row) => row.ar !== null) ? sum(atEnd, (row) => row.ar ?? new D(0)) : null;
  const classes = PAYER_CLASSES.flatMap((payerClass): ClassShare[] => {
    const of = inside.filter((row) => row.payerClass === payerClass);
    if (of.length === 0) return [];
    const classCollected = sum(of, (row) => row.collected);
    const classClaims = sum(of, (row) => row.claims);
    return [{ payerClass, collected: classCollected, claims: classClaims, share: ratio(classCollected, collected), claimShare: ratio(classClaims, claims), yieldPerClaim: ratio(classCollected, classClaims) }];
  });
  return {
    label,
    from: months[0] ?? last,
    to: last,
    missing: months.filter((month) => !inside.some((row) => row.month === month)),
    claims,
    denied: sum(inside, (row) => row.denied),
    billed,
    collected,
    denialRate: ratio(sum(inside, (row) => row.denied), claims),
    collectionRate: ratio(collected, billed),
    arAtEnd,
    daysInAr: arAtEnd && billed.gt(0) ? arAtEnd.div(billed.div(365)) : null,
    byClass: classes,
    rows: inside,
  };
}

const yearMonths = (year: string) => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);

/** Calendar years with all twelve months in the export (the years a trend reads), and those with only some (left out, never scaled up). */
export function collectionYears(rows: readonly RemittanceMonth[]): { years: CollectionsPeriod[]; partialYears: string[] } {
  const all = [...new Set(rows.map((row) => row.month.slice(0, 4)))].sort();
  const periods = all.map((year) => collectionsPeriod(rows, yearMonths(year), year));
  return { years: periods.filter((period) => period.missing.length === 0), partialYears: periods.filter((period) => period.missing.length > 0).map((period) => period.label) };
}

/** The twelve months to the latest remittance month. */
export function trailingCollections(rows: readonly RemittanceMonth[]): CollectionsPeriod | null {
  const latest = rows.at(-1)?.month;
  if (!latest) return null;
  const months = monthsTo(latest);
  return collectionsPeriod(rows, months, `${months[0] ?? latest} to ${latest}`);
}

/** Collections for a set of payer classes in a period, as a share of all its collections. */
export function classGroupShare(period: CollectionsPeriod, classes: readonly PayerClass[]): Decimal | null {
  return ratio(sum(period.byClass.filter((entry) => classes.includes(entry.payerClass)), (entry) => entry.collected), period.collected);
}

// ------------------------------------------------------------------ clinicians

export interface ClinicianMonth {
  readonly id: string;
  readonly month: string;
  readonly providerRef: string;
  readonly site: string;
  readonly visits: Decimal | null;
  readonly collected: Decimal;
}

export function clinicianMonths(evidence: readonly PackRuleEvidence[]): ClinicianMonth[] {
  return evidence
    .filter((row) => row.evidenceType === CLINICIAN_MONTH)
    .flatMap((row) => {
      const month = text(row, 'month');
      const collected = dec(row.canonical['collected']);
      const providerRef = text(row, 'provider_ref');
      if (!MONTH.test(month) || !collected || !providerRef) return [];
      return [{ id: row.id, month, providerRef, site: text(row, 'site'), visits: dec(row.canonical['visits']), collected }];
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.providerRef.localeCompare(b.providerRef) || a.id.localeCompare(b.id));
}

export interface ClinicianShare {
  readonly providerRef: string;
  readonly collected: Decimal;
  readonly share: Decimal | null;
  readonly rows: readonly ClinicianMonth[];
}

/** Collections by clinician over the twelve months to the latest clinician month, largest first. */
export function clinicianShares(rows: readonly ClinicianMonth[]): { from: string; to: string; missing: string[]; total: Decimal; clinicians: ClinicianShare[] } | null {
  const latest = rows.at(-1)?.month;
  if (!latest) return null;
  const months = monthsTo(latest);
  const inside = rows.filter((row) => months.includes(row.month));
  const total = sum(inside, (row) => row.collected);
  const refs = [...new Set(inside.map((row) => row.providerRef))];
  const clinicians = refs
    .map((providerRef) => {
      const of = inside.filter((row) => row.providerRef === providerRef);
      const collected = sum(of, (row) => row.collected);
      return { providerRef, collected, share: ratio(collected, total), rows: of };
    })
    .sort((a, b) => b.collected.comparedTo(a.collected) || a.providerRef.localeCompare(b.providerRef));
  return { from: months[0] ?? latest, to: latest, missing: months.filter((month) => !inside.some((row) => row.month === month)), total, clinicians };
}

/** A pseudonymous reference written as a whole token ("PR-07", never inside "PR-071"). */
export function refPattern(ref: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);
}

const COVENANT = /\b(?:non-?compet\w*|non-?solicit\w*|restrictive covenants?|retention (?:agreement|bonus|arrangement))\b/i;

/** The sentence that names a clinician with a non-compete, non-solicitation or retention agreement, if any document has one. */
export function covenantFor(pages: readonly PackRulePage[], providerRef: string): PackRuleQuote | null {
  const ref = refPattern(providerRef);
  for (const page of pages) {
    if (!ref.test(collapse(page.text))) continue;
    const sentence = sentences(page.text).find((candidate) => ref.test(candidate) && COVENANT.test(candidate));
    if (sentence) return { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) };
  }
  return null;
}

// ------------------------------------------------------------------ credentials

export interface CredentialRow {
  readonly id: string;
  readonly credentialRef: string;
  readonly providerRef: string;
  readonly kind: string;
  readonly jurisdiction: string;
  readonly issuer: string;
  readonly status: string;
  readonly expiresOn: string | null;
  /** The department or service line a hospital privilege is held in (T-162); empty when the register has none. */
  readonly department: string;
}

export function credentialRows(evidence: readonly PackRuleEvidence[]): CredentialRow[] {
  return evidence
    .filter((row) => row.evidenceType === CREDENTIAL)
    .map((row) => ({
      id: row.id,
      credentialRef: text(row, 'credential_ref'),
      providerRef: text(row, 'provider_ref'),
      kind: text(row, 'kind').toLowerCase(),
      jurisdiction: text(row, 'jurisdiction'),
      issuer: text(row, 'issuer'),
      status: text(row, 'status').toLowerCase(),
      expiresOn: dateOf(row, 'expires_on'),
      department: text(row, 'department'),
    }))
    .filter((row) => row.credentialRef && row.providerRef)
    .sort((a, b) => a.providerRef.localeCompare(b.providerRef) || a.credentialRef.localeCompare(b.credentialRef));
}

/** The words a verification sentence uses for each kind of credential. */
const KIND_WORDS: Readonly<Record<string, RegExp>> = {
  state_licence: /\blicen[cs]e\b/i,
  controlled_substance: /\b(?:DEA|controlled[- ]substance)\b/i,
  board_certification: /\bboard[- ]certif\w*/i,
  payer_enrollment: /\benrol(?:l)?ment\b/i,
  // A hospital's medical staff (T-162): clinical privileges, renewed on the medical staff's own cycle.
  hospital_privileges: /\bprivileges?\b/i,
};
const EXPIRY_WORD = /\bexpir(?:es|ed|e|y|ing)\b/i;

/**
 * The expiry a verification document states for a clinician's credential: one sentence that names the
 * pseudonymous reference and the kind of credential and says when it expires ("PR-07: physical therapy
 * licence … expired on 30 April 2026"). The date read is the one after the word.
 */
export function verifiedExpiry(pages: readonly PackRulePage[], providerRef: string, kind: string): { date: string; quote: PackRuleQuote } | null {
  const ref = refPattern(providerRef);
  const word = KIND_WORDS[kind];
  if (!word) return null;
  for (const page of pages) {
    if (!ref.test(collapse(page.text))) continue;
    for (const sentence of sentences(page.text)) {
      if (!ref.test(sentence) || !word.test(sentence)) continue;
      const at = sentence.search(EXPIRY_WORD);
      const date = at >= 0 ? dateIn(sentence.slice(at)) : null;
      if (date) return { date, quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) } };
    }
  }
  return null;
}

/** Days within which a credential expiring after the analysis date is a near expiry. */
export const CREDENTIAL_NEAR_EXPIRY_DAYS = 90;
export type CredentialState = 'EXPIRED' | 'NEAR_EXPIRY' | 'PENDING' | 'ACTIVE' | 'NO_EXPIRY';
export interface CredentialStatus {
  readonly row: CredentialRow;
  readonly state: CredentialState;
  /** The expiry that governs: the verification document's when it states one, else the register's. */
  readonly expiresOn: string | null;
  readonly document: { date: string; quote: PackRuleQuote } | null;
  readonly registerDiffers: boolean;
  /** Whole days from expiry to the analysis date (positive: expired that long ago). */
  readonly daysPastExpiry: number | null;
  /** Collections recorded for the clinician in months that begin after the governing expiry date. */
  readonly collectedAfter: { readonly months: readonly string[]; readonly collected: Decimal; readonly visits: Decimal | null; readonly rows: readonly ClinicianMonth[] } | null;
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Each register row's state at the analysis date, and what the clinician collected after it expired. */
export function credentialStatuses(rows: readonly CredentialRow[], pages: readonly PackRulePage[], asOf: string | null, collections: readonly ClinicianMonth[]): CredentialStatus[] {
  return rows.map((row) => {
    const document = verifiedExpiry(pages, row.providerRef, row.kind);
    const expiresOn = document?.date ?? row.expiresOn;
    const daysPastExpiry = expiresOn && asOf ? days(expiresOn, asOf) : null;
    const lapsedByRegister = ['expired', 'suspended', 'revoked'].includes(row.status);
    const state: CredentialState =
      lapsedByRegister || (daysPastExpiry !== null && daysPastExpiry > 0)
        ? 'EXPIRED'
        : daysPastExpiry !== null && -daysPastExpiry <= CREDENTIAL_NEAR_EXPIRY_DAYS
          ? 'NEAR_EXPIRY'
          : row.status === 'pending'
            ? 'PENDING'
            : expiresOn
              ? 'ACTIVE'
              : 'NO_EXPIRY';
    const after = state === 'EXPIRED' && expiresOn ? collections.filter((month) => month.providerRef === row.providerRef && `${month.month}-01` > expiresOn && month.collected.gt(0)) : [];
    const visits = after.length && after.every((month) => month.visits !== null) ? sum(after, (month) => month.visits ?? new D(0)) : null;
    return {
      row,
      state,
      expiresOn,
      document,
      registerDiffers: Boolean(document && document.date !== row.expiresOn),
      daysPastExpiry,
      collectedAfter: after.length ? { months: after.map((month) => month.month), collected: sum(after, (month) => month.collected), visits, rows: after } : null,
    };
  });
}

/** Rostered clinicians (the provider roster) with no state licence in the register or a verification document. */
export function unlicensedRoster(evidence: readonly PackRuleEvidence[], rows: readonly CredentialRow[], pages: readonly PackRulePage[]): PackRuleEvidence[] {
  return evidence
    .filter((row) => row.evidenceType === ROSTER && text(row, 'provider_ref'))
    .filter((row) => {
      const ref = text(row, 'provider_ref');
      return !rows.some((credential) => credential.providerRef === ref && credential.kind === 'state_licence') && !verifiedExpiry(pages, ref, 'state_licence');
    })
    .sort((a, b) => text(a, 'provider_ref').localeCompare(text(b, 'provider_ref')));
}

// ------------------------------------------------------------------ payer contracts

export interface PayerContract {
  readonly id: string;
  readonly contractId: string;
  readonly payer: string;
  readonly payerClass: PayerClass | null;
  readonly effectiveOn: string | null;
  readonly expiresOn: string | null;
  readonly autoRenews: boolean;
  /** How the payer pays (a DRG case rate, per diem, percent of charges), when the register says (T-162). */
  readonly rateBasis: string | null;
}

export function payerContracts(evidence: readonly PackRuleEvidence[]): PayerContract[] {
  return evidence
    .filter((row) => row.evidenceType === PAYER_CONTRACT)
    .map((row) => ({
      id: row.id,
      contractId: text(row, 'contract_id'),
      payer: text(row, 'payer'),
      payerClass: classOf(text(row, 'payer_class').toLowerCase()),
      effectiveOn: dateOf(row, 'effective_on'),
      expiresOn: dateOf(row, 'expires_on'),
      autoRenews: /^(?:yes|y|true)$/i.test(text(row, 'auto_renews')),
      rateBasis: text(row, 'rate_basis') || null,
    }))
    .filter((row) => row.contractId && row.payer)
    .sort((a, b) => a.payer.localeCompare(b.payer) || a.contractId.localeCompare(b.contractId));
}

/** A contract expiring within this many days of the analysis date, without automatic renewal, is inside the window. */
export const CONTRACT_WINDOW_DAYS = 365;
export type ContractState = 'EXPIRED' | 'EXPIRING' | 'CURRENT' | 'RENEWS' | 'NO_EXPIRY';
export interface PayerContractStatus {
  readonly payer: string;
  readonly payerClass: PayerClass;
  /** Collected from the payer in the trailing twelve months, and its share of all collections. */
  readonly collected: Decimal;
  readonly share: Decimal | null;
  readonly contract: PayerContract | null;
  readonly state: ContractState | 'MISSING';
  /** Days from the analysis date to expiry (negative: expired that long ago). */
  readonly daysToExpiry: number | null;
  readonly rows: readonly RemittanceMonth[];
}

const payerKey = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/** Every payer that remitted in the trailing twelve months (self-pay aside) against the contract register, at the analysis date. */
export function payerContractStatuses(remittances: readonly RemittanceMonth[], contracts: readonly PayerContract[], asOf: string | null): PayerContractStatus[] {
  const trailing = trailingCollections(remittances);
  if (!trailing || !asOf) return [];
  const payers = [...new Set(trailing.rows.filter((row) => row.payerClass !== 'self_pay').map((row) => row.payer))].sort();
  return payers.map((payer) => {
    const rows = trailing.rows.filter((row) => row.payer === payer);
    const collected = sum(rows, (row) => row.collected);
    // The contract that runs longest governs when the register holds several for one payer.
    const contract =
      contracts.filter((entry) => payerKey(entry.payer) === payerKey(payer)).sort((a, b) => (b.expiresOn ?? '9999-12-31').localeCompare(a.expiresOn ?? '9999-12-31'))[0] ?? null;
    const daysToExpiry = contract?.expiresOn ? days(asOf, contract.expiresOn) : null;
    const state: PayerContractStatus['state'] = !contract
      ? 'MISSING'
      : !contract.expiresOn
        ? 'NO_EXPIRY'
        : contract.autoRenews
          ? 'RENEWS'
          : (daysToExpiry ?? 0) < 0
            ? 'EXPIRED'
            : (daysToExpiry ?? 0) <= CONTRACT_WINDOW_DAYS
              ? 'EXPIRING'
              : 'CURRENT';
    return { payer, payerClass: rows[0]?.payerClass ?? 'commercial', collected, share: ratio(collected, trailing.collected), contract, state, daysToExpiry, rows };
  });
}

// ------------------------------------------------------------------ what the documents claim

export type PracticeClaimKey = 'DENIAL_RATE' | 'PAYER_SHARE' | 'DAYS_IN_AR';
export interface PracticeClaim {
  readonly key: PracticeClaimKey;
  readonly label: string;
  /** A percentage (6.1 for 6.1%) for rates and shares; days for days in AR. */
  readonly value: Decimal;
  /** The year the figure is for ("FY2025", "31 December 2025"); null when the sentence names none. */
  readonly year: string | null;
  /** The earlier figure and year a trend claim compares with ("fell from 8.4% in FY2023"). */
  readonly from: { readonly value: Decimal; readonly year: string | null } | null;
  /** DOWN or UP when the sentence says which way the figure moved. */
  readonly movement: 'DOWN' | 'UP' | null;
  /** For a payer-share claim: the classes it covers. */
  readonly classes: readonly PayerClass[];
  readonly quote: PackRuleQuote;
}

const PERCENT_ALL = /(\d+(?:\.\d+)?)\s?%/g;
const YEAR_ALL = /\b(?:FY\s?)?(20\d{2})\b/g;
const DOWN = /\b(?:fell|fallen|falls|down|declin\w*|improv\w*|reduc\w*|lower\w*|dropped)\b/i;
const UP = /\b(?:rose|risen|rises|up|increas\w*|higher|grew|climb\w*)\b/i;
const CLASS_WORDS: readonly [RegExp, readonly PayerClass[], string][] = [
  [/\bcommercial\b/i, ['commercial'], 'Commercial payer share'],
  [/\bmedicare\b/i, ['medicare'], 'Medicare share'],
  [/\bmedicaid\b/i, ['medicaid'], 'Medicaid share'],
  [/\bgovernment\b/i, GOVERNMENT_CLASSES, 'Government payer share'],
  [/\bself-?pay\b/i, ['self_pay'], 'Self-pay share'],
];
const DAYS = /(\d+(?:\.\d+)?)\s*days\b/i;

/** The practice claims a deck or memorandum states: the denial rate, a payer class's share of collections and days in AR, first of each. */
export function practiceClaims(pages: readonly PackRulePage[]): PracticeClaim[] {
  const found = new Map<PracticeClaimKey, PracticeClaim>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      const quote = { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(sentence) };
      const percents = [...sentence.matchAll(PERCENT_ALL)].map((match) => new D(match[1] ?? '0'));
      const years = [...sentence.matchAll(YEAR_ALL)].map((match) => match[1] ?? '');
      const movement = DOWN.test(sentence) ? 'DOWN' : UP.test(sentence) ? 'UP' : null;
      const add = (claim: Omit<PracticeClaim, 'quote'>) => {
        if (!found.has(claim.key)) found.set(claim.key, { ...claim, quote });
      };
      if (/\bdenial rate\b/i.test(sentence) && percents.length) {
        const value = percents.at(-1) as Decimal;
        add({
          key: 'DENIAL_RATE',
          label: 'Denial rate',
          value,
          year: years.at(-1) ?? null,
          from: percents.length > 1 ? { value: percents[0] as Decimal, year: years.length > 1 ? (years[0] ?? null) : null } : null,
          movement,
          classes: [],
        });
      } else if (/\b(?:days in (?:accounts )?receivables?|days in A\/R|DSO)\b/i.test(sentence)) {
        const match = DAYS.exec(sentence);
        if (match) add({ key: 'DAYS_IN_AR', label: 'Days in accounts receivable', value: new D(match[1] ?? '0'), year: years.at(-1) ?? null, from: null, movement: null, classes: [] });
      } else if (percents.length && /\b(?:collections|payer mix|of (?:net )?(?:patient )?revenue)\b/i.test(sentence)) {
        const payer = CLASS_WORDS.find(([pattern]) => pattern.test(sentence));
        if (payer) add({ key: 'PAYER_SHARE', label: payer[2], value: percents.at(-1) as Decimal, year: years.at(-1) ?? null, from: null, movement, classes: payer[1] });
      }
    }
  }
  return [...found.values()];
}

// ------------------------------------------------------------------ compliance evidence

export type HealthcareComplianceKind = 'HIPAA_RISK_ASSESSMENT' | 'CODING_AUDIT' | 'LICENCE_VERIFICATION' | 'RESTRICTIVE_COVENANTS';
export interface HealthcareComplianceDocument {
  readonly kind: HealthcareComplianceKind;
  readonly documentId: string;
  /** The heading it was recognised by. */
  readonly quote: PackRuleQuote;
  /** The date it states (an assessment, audit or verification date), when it states one. */
  readonly date: string | null;
}

const HEADINGS: readonly [HealthcareComplianceKind, RegExp][] = [
  ['HIPAA_RISK_ASSESSMENT', /\b(?:HIPAA|security risk assessment|privacy risk assessment)\b/i],
  ['CODING_AUDIT', /\b(?:coding (?:and billing )?audit|billing audit|claims audit|coding review)\b/i],
  ['LICENCE_VERIFICATION', /\b(?:licen[cs]e verification|primary[- ]source verification|credential(?:ing)? verification)\b/i],
  ['RESTRICTIVE_COVENANTS', /\b(?:non-?compet\w*|restrictive covenants?|retention agreements?)\b/i],
];
const DATED = /\b(?:assessment date|audit date|date of (?:the )?(?:audit|review|verification)|dated|verified on|as of|report date)\b/i;

/** Compliance documents recognised by the heading on their first page; one per document. */
export function healthcareComplianceDocuments(pages: readonly PackRulePage[]): HealthcareComplianceDocument[] {
  const firstPages = new Map<string, PackRulePage>();
  for (const page of pages) {
    const seen = firstPages.get(page.documentId);
    if (!seen || page.pageNumber < seen.pageNumber) firstPages.set(page.documentId, page);
  }
  const found: HealthcareComplianceDocument[] = [];
  for (const page of [...firstPages.values()].sort((a, b) => a.documentId.localeCompare(b.documentId))) {
    // The heading is the first sentence, or the second when a company name ending "Inc." splits it.
    const opening = sentences(page.text).slice(0, 2);
    const match = opening.flatMap((sentence) => HEADINGS.filter(([, pattern]) => pattern.test(sentence)).map(([kind]) => ({ kind, sentence })))[0];
    if (!match) continue;
    const { kind, sentence: heading } = match;
    const dated = sentences(page.text).find((sentence) => DATED.test(sentence) && dateIn(sentence));
    found.push({ kind, documentId: page.documentId, quote: { documentId: page.documentId, pageNumber: page.pageNumber, quote: cap(heading) }, date: dated ? dateIn(dated) : null });
  }
  return found;
}

/** A coding or billing audit older than this many days at the analysis date is stale (audits are annual). */
export const CODING_AUDIT_STALE_DAYS = 365;
