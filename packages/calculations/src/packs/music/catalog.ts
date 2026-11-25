import { D } from '../../metrics/decimal';
import type { PackRuleEvidence } from '../rule-types';

/**
 * Music rights (T-140, ADR 0041): the catalog model behind the register, the royalty income
 * model and the termination-exposure analysis. Deterministic and decimal-only; every figure comes
 * from imported (or person-confirmed) register rows and statements. Absence is shown as absence:
 * a work with no statement line earns nothing here, and a missing period is a gap, never an estimate.
 */
export const MUSIC_CATALOG_VERSION = 'music-catalog-1';

export const MUSIC_EVIDENCE = {
  WORK: 'music.work',
  SPLIT: 'music.split',
  GRANT: 'music.grant',
  ROYALTY: 'music.royalty_line',
} as const;
export const MUSIC_EVIDENCE_TYPES = Object.values(MUSIC_EVIDENCE);

type Decimal = InstanceType<typeof D>;

/** Thresholds the catalog checks use; every finding states the one it applied. */
export const MUSIC_THRESHOLDS = {
  /** Termination exposure is drafted at or above this share of trailing income. */
  terminationShare: '0.10',
  /** The top work above this share of trailing income is a concentration finding. */
  topWorkShare: '0.15',
  /** The top writer (by split-sheet share of each work's income) above this share. */
  topWriterShare: '0.25',
  /** Splits must total 100% within this many points; a statement must agree with the split sheet within it. */
  splitPoints: '0.5',
  /** Trailing income at least this much above the prior year is verified growth (confirmed value only). */
  verifiedGrowth: '0.05',
  /** Leakage: share of comparable compositions (same age band) that earn performance income. */
  leakagePeers: '0.5',
} as const;

/** The hold the termination analysis assumes when no document states "hold period of N years". */
export const MUSIC_DEFAULT_HOLD_YEARS = 10;

/** Stated with every termination result (17 U.S.C. §203 and §304(c)). Not legal advice. */
export const MUSIC_TERMINATION_CONVENTIONS = [
  '§203: grants made by the author on or after 1 January 1978 are terminable for five years from 35 years after execution; when the grant covers publication, from the earlier of 35 years after publication and 40 years after execution.',
  '§304(c): for copyrights secured before 1978, five years from 56 years after copyright was secured (or 1 January 1978, if later).',
  'Only assignments and licences in the chain are analysed; registrations, administration agreements and works made for hire are not terminable here, and works not governed by US law are not analysed.',
  'A window is inside the hold when it is open at any time between the analysis date (the latest statement period end) and the end of the hold. Where the grantor is a writer on the split sheet, only that writer’s share of the work’s income is exposed.',
  'Whether a notice has been served, or could validly be served (2 to 10 years ahead), is for counsel.',
] as const;

export const MUSIC_INCOME_CONVENTIONS = [
  'Trailing income: statement lines whose period ends in the twelve months to the latest period end; prior year: the twelve months before that.',
  'Amounts are net to the catalog owner (net publisher’s share or net label share), in the deal’s base currency, as the statements state them.',
  'Decay: each catalog-age band’s trailing income is reduced by its year-on-year decline; growth is never added (verified growth is confirmed value, not price).',
] as const;

const field = (row: PackRuleEvidence, name: string) => (row.canonical[name] ?? '').trim();
const amount = (row: PackRuleEvidence, name: string) => {
  const text = field(row, name);
  return /^-?\d+(\.\d+)?$/.test(text) ? new D(text) : new D(0);
};
const isDate = (text: string) => /^\d{4}-\d{2}-\d{2}/.test(text);
const dateOf = (text: string) => text.slice(0, 10);

/** "2026-06-30" plus whole years, clamping 29 February to the 28th. */
export function addYears(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) + years;
  const month = date.slice(5, 7);
  let day = date.slice(8, 10);
  if (month === '02' && day === '29' && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) day = '28';
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

const earlier = (a: string, b: string) => (a <= b ? a : b);
const later = (a: string, b: string) => (a >= b ? a : b);

export interface MusicWork {
  readonly id: string;
  readonly evidenceId: string;
  readonly title: string;
  readonly type: string;
  readonly pro: string;
  readonly releaseYear: number | null;
  readonly usWork: boolean;
}

export interface MusicSplit {
  readonly id: string;
  readonly workId: string;
  readonly writer: string;
  readonly share: Decimal;
  readonly source: 'split_sheet' | 'statement';
}

export interface MusicGrant {
  readonly id: string;
  readonly workId: string;
  readonly type: string;
  readonly executedOn: string | null;
  readonly publicationDate: string | null;
  readonly copyrightSecuredOn: string | null;
  readonly grantor: string | null;
  readonly reference: string | null;
}

export interface RoyaltyLine {
  readonly id: string;
  readonly periodEnd: string;
  readonly workId: string;
  readonly source: string;
  readonly payer: string;
  readonly amount: Decimal;
}

export interface CatalogRows {
  readonly works: readonly MusicWork[];
  readonly splits: readonly MusicSplit[];
  readonly grants: readonly MusicGrant[];
  readonly lines: readonly RoyaltyLine[];
}

/** The register rows by type; malformed rows (no work id, no date) are left out, never guessed. */
export function catalogRows(evidence: readonly PackRuleEvidence[]): CatalogRows {
  const works: MusicWork[] = [];
  const splits: MusicSplit[] = [];
  const grants: MusicGrant[] = [];
  const lines: RoyaltyLine[] = [];
  for (const row of evidence) {
    if (row.evidenceType === MUSIC_EVIDENCE.WORK && field(row, 'work_id')) {
      const year = field(row, 'release_year');
      works.push({
        id: field(row, 'work_id'),
        evidenceId: row.id,
        title: field(row, 'title') || field(row, 'work_id'),
        type: field(row, 'work_type').toLowerCase(),
        pro: field(row, 'pro'),
        releaseYear: /^\d{4}(\.0+)?$/.test(year) ? Number(year.slice(0, 4)) : null,
        usWork: ['yes', 'y', 'true', 'us'].includes(field(row, 'us_work').toLowerCase()),
      });
    } else if (row.evidenceType === MUSIC_EVIDENCE.SPLIT && field(row, 'work_id') && field(row, 'writer_ref')) {
      const source = field(row, 'source').toLowerCase();
      if (source !== 'split_sheet' && source !== 'statement') continue;
      splits.push({ id: row.id, workId: field(row, 'work_id'), writer: field(row, 'writer_ref'), share: amount(row, 'share_pct'), source });
    } else if (row.evidenceType === MUSIC_EVIDENCE.GRANT && field(row, 'work_id')) {
      const date = (name: string) => (isDate(field(row, name)) ? dateOf(field(row, name)) : null);
      grants.push({
        id: row.id,
        workId: field(row, 'work_id'),
        type: field(row, 'grant_type').toLowerCase(),
        executedOn: date('executed_on'),
        publicationDate: date('publication_date'),
        copyrightSecuredOn: date('copyright_secured_on'),
        grantor: field(row, 'grantor_ref') || null,
        reference: field(row, 'reference') || null,
      });
    } else if (row.evidenceType === MUSIC_EVIDENCE.ROYALTY && field(row, 'work_id') && isDate(field(row, 'period_end'))) {
      lines.push({ id: row.id, periodEnd: dateOf(field(row, 'period_end')), workId: field(row, 'work_id'), source: field(row, 'income_source').toLowerCase(), payer: field(row, 'payer') || 'Unnamed payer', amount: amount(row, 'amount') });
    }
  }
  const byId = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
  return { works: works.sort((a, b) => a.id.localeCompare(b.id)), splits: byId(splits), grants: byId(grants), lines: lines.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.id.localeCompare(b.id)) };
}

export const AGE_BANDS = [
  { key: '0-2', label: '0–2 years', max: 2 },
  { key: '3-5', label: '3–5 years', max: 5 },
  { key: '6-10', label: '6–10 years', max: 10 },
  { key: '11-20', label: '11–20 years', max: 20 },
  { key: '21+', label: '21 years and older', max: Number.POSITIVE_INFINITY },
] as const;
const UNKNOWN_BAND = { key: 'unknown', label: 'Not in the register (age unknown)' } as const;

export interface WorkIncome {
  readonly workId: string;
  readonly trailing: Decimal;
  readonly prior: Decimal;
  readonly bySource: ReadonlyMap<string, Decimal>;
  /** The trailing lines, for citation. */
  readonly lineIds: readonly string[];
}

export interface BandIncome {
  readonly key: string;
  readonly label: string;
  readonly works: number;
  readonly trailing: Decimal;
  readonly prior: Decimal;
  /** Trailing ÷ prior − 1; null when the prior year has no income (no history to measure decay on). */
  readonly change: Decimal | null;
  readonly decayAdjusted: Decimal;
}

export interface IncomeModel {
  readonly latestPeriodEnd: string | null;
  /** Exclusive start of the trailing year, and of the prior year. */
  readonly trailingFrom: string | null;
  readonly priorFrom: string | null;
  readonly periods: readonly string[];
  readonly trailing: Decimal;
  readonly prior: Decimal;
  readonly decayAdjusted: Decimal;
  readonly byWork: ReadonlyMap<string, WorkIncome>;
  readonly bySource: ReadonlyMap<string, Decimal>;
  readonly bands: readonly BandIncome[];
}

/** Trailing and prior-year income by work, source and catalog-age band, with the decay adjustment. */
export function incomeModel(rows: CatalogRows): IncomeModel {
  const latest = rows.lines.at(-1)?.periodEnd ?? null;
  const empty: IncomeModel = { latestPeriodEnd: null, trailingFrom: null, priorFrom: null, periods: [], trailing: new D(0), prior: new D(0), decayAdjusted: new D(0), byWork: new Map(), bySource: new Map(), bands: [] };
  if (!latest) return empty;
  const trailingFrom = addYears(latest, -1);
  const priorFrom = addYears(latest, -2);
  const byWork = new Map<string, { trailing: Decimal; prior: Decimal; bySource: Map<string, Decimal>; lineIds: string[] }>();
  const bySource = new Map<string, Decimal>();
  let trailing = new D(0);
  let prior = new D(0);
  for (const line of rows.lines) {
    const entry = byWork.get(line.workId) ?? { trailing: new D(0), prior: new D(0), bySource: new Map<string, Decimal>(), lineIds: [] };
    if (line.periodEnd > trailingFrom) {
      entry.trailing = entry.trailing.plus(line.amount);
      entry.bySource.set(line.source, (entry.bySource.get(line.source) ?? new D(0)).plus(line.amount));
      entry.lineIds.push(line.id);
      bySource.set(line.source, (bySource.get(line.source) ?? new D(0)).plus(line.amount));
      trailing = trailing.plus(line.amount);
    } else if (line.periodEnd > priorFrom) {
      entry.prior = entry.prior.plus(line.amount);
      prior = prior.plus(line.amount);
    }
    byWork.set(line.workId, entry);
  }
  const latestYear = Number(latest.slice(0, 4));
  const register = new Map(rows.works.map((work) => [work.id, work]));
  const bandOf = (workId: string) => {
    const year = register.get(workId)?.releaseYear;
    if (year === null || year === undefined) return UNKNOWN_BAND;
    const age = Math.max(0, latestYear - year);
    return AGE_BANDS.find((band) => age <= band.max) ?? UNKNOWN_BAND;
  };
  const bands = new Map<string, { label: string; works: Set<string>; trailing: Decimal; prior: Decimal }>();
  for (const workId of new Set([...rows.works.map((work) => work.id), ...byWork.keys()])) {
    const band = bandOf(workId);
    const entry = bands.get(band.key) ?? { label: band.label, works: new Set<string>(), trailing: new D(0), prior: new D(0) };
    const income = byWork.get(workId);
    entry.works.add(workId);
    if (income) {
      entry.trailing = entry.trailing.plus(income.trailing);
      entry.prior = entry.prior.plus(income.prior);
    }
    bands.set(band.key, entry);
  }
  const order: string[] = [...AGE_BANDS.map((band) => band.key), UNKNOWN_BAND.key];
  const bandList: BandIncome[] = [...bands.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, band]) => {
      const change = band.prior.gt(0) ? band.trailing.div(band.prior).minus(1) : null;
      const decline = change && change.lt(0) ? change : new D(0);
      return { key, label: band.label, works: band.works.size, trailing: band.trailing, prior: band.prior, change, decayAdjusted: band.trailing.times(new D(1).plus(decline)) };
    });
  return {
    latestPeriodEnd: latest,
    trailingFrom,
    priorFrom,
    periods: [...new Set(rows.lines.map((line) => line.periodEnd))],
    trailing,
    prior,
    decayAdjusted: bandList.reduce((total, band) => total.plus(band.decayAdjusted), new D(0)),
    byWork: new Map([...byWork.entries()].map(([workId, entry]) => [workId, { workId, ...entry }])),
    bySource,
    bands: bandList,
  };
}

export interface TerminationWindow {
  readonly statute: '§203' | '§304(c)';
  readonly opens: string;
  readonly closes: string;
}

const TERMINABLE = new Set(['assignment', 'license']);

/** A grant's termination window under the stated conventions, or null when none applies (or the dates to compute it are missing). */
export function terminationWindow(grant: MusicGrant, usWork: boolean): TerminationWindow | null {
  if (!usWork || !TERMINABLE.has(grant.type)) return null;
  if (grant.copyrightSecuredOn && grant.copyrightSecuredOn < '1978-01-01') {
    const opens = later(addYears(grant.copyrightSecuredOn, 56), '1978-01-01');
    return { statute: '§304(c)', opens, closes: addYears(opens, 5) };
  }
  if (!grant.executedOn || grant.executedOn < '1978-01-01') return null;
  const opens = grant.publicationDate ? earlier(addYears(grant.publicationDate, 35), addYears(grant.executedOn, 40)) : addYears(grant.executedOn, 35);
  return { statute: '§203', opens, closes: addYears(opens, 5) };
}

export interface ExposedGrant {
  readonly grantId: string;
  readonly workId: string;
  readonly title: string;
  readonly window: TerminationWindow;
  /** The share of the work's income this grant carries (the grantor's split-sheet share, else the whole work). */
  readonly share: Decimal;
  readonly exposedIncome: Decimal;
}

export interface TerminationExposure {
  readonly analysisDate: string | null;
  readonly holdYears: number;
  readonly holdEnds: string | null;
  readonly trailing: Decimal;
  readonly exposedIncome: Decimal;
  /** Exposed ÷ trailing income; null with no trailing income. */
  readonly share: Decimal | null;
  readonly grants: readonly ExposedGrant[];
  /** US works with assignments or licences but no dates to compute a window from. */
  readonly undated: readonly string[];
  readonly conventions: readonly string[];
}

/** Income whose underlying grants become terminable inside the hold, quantified separately. */
export function terminationExposure(rows: CatalogRows, income: IncomeModel, holdYears: number): TerminationExposure {
  const analysisDate = income.latestPeriodEnd;
  const holdEnds = analysisDate ? addYears(analysisDate, holdYears) : null;
  const works = new Map(rows.works.map((work) => [work.id, work]));
  const grants: ExposedGrant[] = [];
  const undated = new Set<string>();
  const exposedShare = new Map<string, Decimal>();
  for (const grant of rows.grants) {
    const work = works.get(grant.workId);
    if (!work?.usWork || !analysisDate || !holdEnds) continue;
    const window = terminationWindow(grant, true);
    if (!window) {
      if (TERMINABLE.has(grant.type)) undated.add(grant.workId);
      continue;
    }
    if (window.opens > holdEnds || window.closes < analysisDate) continue;
    const writerShare = grant.grantor ? rows.splits.find((split) => split.workId === grant.workId && split.source === 'split_sheet' && split.writer === grant.grantor)?.share : undefined;
    const share = writerShare ? writerShare.div(100) : new D(1);
    const already = exposedShare.get(grant.workId) ?? new D(0);
    const counted = D.min(share, new D(1).minus(already));
    if (!counted.gt(0)) continue;
    exposedShare.set(grant.workId, already.plus(counted));
    const workIncome = income.byWork.get(grant.workId)?.trailing ?? new D(0);
    grants.push({ grantId: grant.id, workId: grant.workId, title: work.title, window, share: counted, exposedIncome: workIncome.times(counted) });
  }
  const exposedIncome = grants.reduce((total, grant) => total.plus(grant.exposedIncome), new D(0));
  return {
    analysisDate,
    holdYears,
    holdEnds,
    trailing: income.trailing,
    exposedIncome,
    share: income.trailing.gt(0) ? exposedIncome.div(income.trailing) : null,
    grants: grants.sort((a, b) => b.exposedIncome.comparedTo(a.exposedIncome) || a.grantId.localeCompare(b.grantId)),
    undated: [...undated].sort(),
    conventions: MUSIC_TERMINATION_CONVENTIONS,
  };
}

/** Each split-sheet writer's trailing income: Σ over their works of the work's trailing income × their share. */
export function writerIncome(rows: CatalogRows, income: IncomeModel): Map<string, Decimal> {
  const byWriter = new Map<string, Decimal>();
  for (const split of rows.splits) {
    if (split.source !== 'split_sheet') continue;
    const work = income.byWork.get(split.workId)?.trailing ?? new D(0);
    byWriter.set(split.writer, (byWriter.get(split.writer) ?? new D(0)).plus(work.times(split.share).div(100)));
  }
  return byWriter;
}

/** Statement periods a payer skipped between its first and last statement (the catalog's own period list). */
export function statementGaps(rows: CatalogRows): { payer: string; missing: string[]; lineIds: string[] }[] {
  const periods = [...new Set(rows.lines.map((line) => line.periodEnd))].sort();
  const byPayer = new Map<string, RoyaltyLine[]>();
  for (const line of rows.lines) byPayer.set(line.payer, [...(byPayer.get(line.payer) ?? []), line]);
  const gaps: { payer: string; missing: string[]; lineIds: string[] }[] = [];
  for (const [payer, lines] of [...byPayer.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const own = new Set(lines.map((line) => line.periodEnd));
    const first = lines[0]?.periodEnd ?? '';
    const last = lines.at(-1)?.periodEnd ?? '';
    const missing = periods.filter((period) => period > first && period < last && !own.has(period));
    if (missing.length) gaps.push({ payer, missing, lineIds: lines.map((line) => line.id) });
  }
  return gaps;
}

/** The hold period a document states ("hold period of 7 years"), else the default. */
export function statedHoldYears(pages: readonly { readonly text: string }[]): { years: number; stated: boolean } {
  for (const page of pages) {
    const match = /hold(?:ing)? period of (\d{1,2}) years/i.exec(page.text.replace(/\s+/g, ' '));
    const years = match ? Number(match[1]) : 0;
    if (years >= 1 && years <= 30) return { years, stated: true };
  }
  return { years: MUSIC_DEFAULT_HOLD_YEARS, stated: false };
}
