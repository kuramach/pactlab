import type { CsvTable } from '../evidence/csv';
import type { FieldSource } from './mapping';
import { subtotalConflicts, type ImportGuidance } from './guidance';
import type { TargetDefinition } from './targets';

/**
 * Real-world files (Kumar, 2026-11-21: "not in the exact format as Pactlab has"): a header below title rows, months
 * across the columns, a P&L with subtotal lines. Everything here is deterministic: the mapping
 * assistant (a model) only proposes which row is the header, which column feeds which field and what
 * each P&L line is; these functions check every proposal against the file and read the values.
 */

/** Synthetic columns a reshaped table carries (never real header text in the file). */
export const PERIOD_COLUMN = 'Period (from columns)';
export const VALUE_COLUMN = 'Amount (from columns)';

export interface PeriodColumn {
  /** A header cell of the file. */
  readonly column: string;
  /** YYYY-MM for a month, or YYYY for a year (a statement by year, Kumar 2026-11-25). */
  readonly period: string;
}

/**
 * How the file is laid out:
 * - ROWS: one record per row (the standard template);
 * - PERIOD_COLUMNS: lines down, months across (a P&L): one record per line per month;
 * - MONTHS_ACROSS: measures down, months across (a T-12): each month column becomes a row, and the
 *   row labels (in `labelColumn`) become the columns the fields are mapped from.
 */
export type ImportLayout =
  | { readonly kind: 'ROWS' }
  | { readonly kind: 'PERIOD_COLUMNS'; readonly periods: readonly PeriodColumn[] }
  | { readonly kind: 'MONTHS_ACROSS'; readonly labelColumn: string; readonly periods: readonly PeriodColumn[] };

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^(19|20)\d{2}$/;
/** A year (YYYY), as a statement by year gives its periods. */
export const isYearPeriod = (period: string) => YEAR.test(period);
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A header cell as a period: a month ("Jan 2026", "January 2026", "Jan-26", "2026-01", "01/2026" → 2026-01) or a
 * year ("2021", "FY2021", "FY 2021", "2021 Actual" → 2021); else null.
 */
export function periodOfHeader(text: string): string | null {
  const value = text.trim().toLowerCase();
  const annual = /^(?:fy|cy|year)?\s*'?((?:19|20)\d{2})(?:\s+(?:actual|actuals|total|a))?$/.exec(value);
  if (annual) return annual[1] ?? null;
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);
  if (iso && PERIOD.test(`${iso[1]}-${iso[2]}`)) return `${iso[1]}-${iso[2]}`;
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) {
    const period = `${slash[2]}-${(slash[1] ?? '').padStart(2, '0')}`;
    return PERIOD.test(period) ? period : null;
  }
  const named = /^([a-z]{3})[a-z]*\.?[\s-]+'?(\d{2}|\d{4})$/.exec(value);
  const month = named ? MONTH_NAMES.indexOf(named[1] ?? '') : -1;
  if (!named || month < 0) return null;
  const year = (named[2] ?? '').length === 2 ? `20${named[2]}` : named[2];
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * The layout read from the header alone, without the assistant: two or more month columns mean months
 * run across (line by line for a statement, measures down the side for a monthly target).
 */
export function guessLayout(definition: TargetDefinition, header: readonly string[]): ImportLayout {
  const periods = header.flatMap((column) => {
    const period = periodOfHeader(column);
    return period ? [{ column, period }] : [];
  });
  const label = header.find((column) => !periodOfHeader(column));
  if (periods.length < 2 || new Set(periods.map((entry) => entry.period)).size !== periods.length || !label) return { kind: 'ROWS' };
  // One granularity: all months, or (a statement only) all years.
  const years = periods.filter((entry) => isYearPeriod(entry.period)).length;
  if (years > 0 && years < periods.length) return { kind: 'ROWS' };
  if (definition.lineItems) return { kind: 'PERIOD_COLUMNS', periods };
  if (years === 0 && definition.fields.some((field) => field.name === 'month')) return { kind: 'MONTHS_ACROSS', labelColumn: label, periods };
  return { kind: 'ROWS' };
}
const blank = (cell: string | undefined) => (cell ?? '').trim() === '';
const NUMERIC = /^[\s$€£(+-]*[\d.,'\s]+[)%-]?\s*$/;

/**
 * The header row of a sheet's first rows (1-based among non-empty rows): the first row that spans at
 * least half the sheet's width and is mostly words, not numbers. Title rows ("Acme LLC", "Income
 * statement, FY2026") above it are skipped. 1 when nothing better is found.
 */
export function detectHeaderRow(preview: readonly (readonly string[])[]): number {
  const filledWidth = (row: readonly string[]) => row.filter((cell) => !blank(cell)).length;
  const widest = Math.max(0, ...preview.map(filledWidth));
  if (widest < 2) return 1;
  for (const [index, row] of preview.slice(0, 20).entries()) {
    const cells = row.filter((cell) => !blank(cell));
    if (cells.length < Math.max(2, Math.ceil(widest / 2))) continue;
    // Period headers ("2021", "FY2022") are words here, not figures.
    const words = cells.filter((cell) => !NUMERIC.test(cell) || periodOfHeader(cell) !== null).length;
    if (words >= Math.ceil(cells.length / 2)) return index + 1;
  }
  return 1;
}

/** Problems with a layout against the table read under the chosen header; empty when it can be applied. */
export function layoutProblems(definition: TargetDefinition, header: readonly string[], layout: ImportLayout | undefined): string[] {
  if (!layout || layout.kind === 'ROWS') return [];
  const problems: string[] = [];
  if (layout.periods.length === 0) problems.push('Choose the columns that hold the periods');
  const seen = new Set<string>();
  const years = layout.periods.filter((entry) => isYearPeriod(entry.period)).length;
  if (years > 0 && (layout.kind === 'MONTHS_ACROSS' || years < layout.periods.length)) problems.push(layout.kind === 'MONTHS_ACROSS' ? `${definition.label} is monthly, so its columns must be months` : 'Use months for every column, or years for every column');
  for (const { column, period } of layout.periods) {
    if (!header.includes(column)) problems.push(`Period column "${column}" is not in the file`);
    if (!PERIOD.test(period) && !(layout.kind === 'PERIOD_COLUMNS' && isYearPeriod(period))) problems.push(`"${column}": the period must be a month (YYYY-MM) or a year (YYYY)`);
    if (seen.has(period)) problems.push(`${period} is chosen for two columns`);
    seen.add(period);
  }
  const monthField = definition.fields.find((field) => field.name === 'month');
  if (!monthField) problems.push(`${definition.label} has no month, so months across cannot be read`);
  if (layout.kind === 'PERIOD_COLUMNS' && !definition.lineItems) problems.push(`${definition.label} is not a line-by-line statement`);
  if (layout.kind === 'MONTHS_ACROSS' && !header.includes(layout.labelColumn)) problems.push(`Label column "${layout.labelColumn}" is not in the file`);
  return problems;
}

/** The table as one record per row, whatever the layout. Call only when `layoutProblems` is empty. */
export function reshapeTable(table: CsvTable, layout: ImportLayout | undefined): CsvTable {
  if (!layout || layout.kind === 'ROWS') return table;
  const index = new Map(table.header.map((name, at) => [name, at]));
  const periodColumns = new Set(layout.periods.map((entry) => entry.column));
  if (layout.kind === 'PERIOD_COLUMNS') {
    const kept = table.header.map((name, at) => ({ name, at })).filter((entry) => !periodColumns.has(entry.name));
    const rows: CsvTable['rows'][number][] = [];
    for (const row of table.rows) {
      for (const { column, period } of layout.periods) {
        const value = row.cells[index.get(column) ?? -1] ?? '';
        if (blank(value)) continue;
        rows.push({ cells: [...kept.map((entry) => row.cells[entry.at] ?? ''), period, value], text: row.text });
      }
    }
    return { header: [...kept.map((entry) => entry.name), PERIOD_COLUMN, VALUE_COLUMN], rows };
  }
  const labelAt = index.get(layout.labelColumn) ?? -1;
  const seen = new Map<string, number>();
  const labelled = table.rows
    .map((row) => ({ row, label: (row.cells[labelAt] ?? '').trim() }))
    .filter((entry) => entry.label !== '')
    .map((entry) => {
      const count = (seen.get(entry.label) ?? 0) + 1;
      seen.set(entry.label, count);
      return { ...entry, label: count === 1 ? entry.label : `${entry.label} (${count})` };
    });
  const header = [PERIOD_COLUMN, ...labelled.map((entry) => entry.label)];
  const rows = layout.periods.map(({ column, period }) => {
    const cells = [period, ...labelled.map((entry) => entry.row.cells[index.get(column) ?? -1] ?? '')];
    return { cells, text: cells.map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',') };
  });
  return { header, rows };
}

// ——— P&L lines ———

/** What a P&L line is. Lines are imported; subtotals are checked against them, never imported. */
export const PNL_LINE_KINDS = ['REVENUE', 'COGS', 'OPEX', 'OTHER_INCOME', 'OTHER_EXPENSE'] as const;
export const PNL_SUBTOTAL_KINDS = ['TOTAL_REVENUE', 'TOTAL_COGS', 'GROSS_PROFIT', 'TOTAL_OPEX', 'OPERATING_INCOME', 'NET_INCOME', 'OTHER_SUBTOTAL'] as const;
export const PNL_KINDS = [...PNL_LINE_KINDS, ...PNL_SUBTOTAL_KINDS] as const;
export type PnlKind = (typeof PNL_KINDS)[number];
export type PnlLineKind = (typeof PNL_LINE_KINDS)[number];
export const isPnlLine = (kind: PnlKind): kind is PnlLineKind => (PNL_LINE_KINDS as readonly string[]).includes(kind);

/** Exact decimal strings as scaled integers (never JavaScript floats): six decimal places is ample for money. */
const SCALE = 6;
function toScaled(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = BigInt(whole || '0') * 10n ** BigInt(SCALE) + BigInt((fraction + '0'.repeat(SCALE)).slice(0, SCALE) || '0');
  return negative ? -scaled : scaled;
}
function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(SCALE + 1, '0');
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  const text = fraction ? `${digits.slice(0, -SCALE)}.${fraction}` : digits.slice(0, -SCALE);
  return negative && text !== '0' ? `-${text}` : text;
}
/** One currency unit: rounding in the file's own totals is not a gap. */
const TOLERANCE = 10n ** BigInt(SCALE);

export interface TieOutGap {
  readonly account: string;
  readonly month: string;
  readonly kind: PnlKind;
  /** What the file says, and what its lines add up to (either sign convention), as decimal strings. */
  readonly stated: string;
  readonly computed: string;
}

/**
 * Check every subtotal line against the lines it totals, per month. Expenses may be written positive
 * (subtracted) or negative (added); a subtotal matching either convention ties out.
 */
export function pnlTieOut(lines: readonly { account: string; month: string; amount: string; kind: PnlKind }[]): TieOutGap[] {
  const sums = new Map<string, Record<PnlLineKind, bigint>>();
  const zero = (): Record<PnlLineKind, bigint> => ({ REVENUE: 0n, COGS: 0n, OPEX: 0n, OTHER_INCOME: 0n, OTHER_EXPENSE: 0n });
  for (const line of lines) {
    if (!isPnlLine(line.kind)) continue;
    const month = sums.get(line.month) ?? zero();
    month[line.kind] += toScaled(line.amount);
    sums.set(line.month, month);
  }
  const gaps: TieOutGap[] = [];
  for (const line of lines) {
    if (isPnlLine(line.kind) || line.kind === 'OTHER_SUBTOTAL') continue;
    const s = sums.get(line.month) ?? zero();
    // Expenses positive: subtract them. Expenses negative: add them.
    const candidates = [-1n, 1n].map((sign) => {
      switch (line.kind) {
        case 'TOTAL_REVENUE':
          return s.REVENUE;
        case 'TOTAL_COGS':
          return s.COGS;
        case 'TOTAL_OPEX':
          return s.OPEX;
        case 'GROSS_PROFIT':
          return s.REVENUE + sign * s.COGS;
        case 'OPERATING_INCOME':
          return s.REVENUE + sign * (s.COGS + s.OPEX);
        default:
          return s.REVENUE + sign * (s.COGS + s.OPEX + s.OTHER_EXPENSE) + s.OTHER_INCOME;
      }
    });
    const stated = toScaled(line.amount);
    const off = (value: bigint) => (value - stated < 0n ? stated - value : value - stated);
    if (candidates.some((value) => off(value) <= TOLERANCE)) continue;
    const nearest = off(candidates[0] ?? 0n) <= off(candidates[1] ?? 0n) ? candidates[0] : candidates[1];
    gaps.push({ account: line.account, month: line.month, kind: line.kind, stated: fromScaled(stated), computed: fromScaled(nearest ?? 0n) });
  }
  return gaps;
}

/** One month of an imported P&L, from its lines only (subtotals are never summed). Decimal strings; costs as positive amounts. */
export interface PnlMonthTotals {
  readonly month: string;
  readonly revenue: string;
  readonly costOfRevenue: string;
  readonly grossProfit: string;
  readonly operatingExpenses: string;
  readonly operatingIncome: string;
  readonly netIncome: string;
}

/**
 * What an imported P&L adds up to, month by month (Kumar, 2026-11-25: "what metrics it derived"). Deterministic,
 * from the lines and their confirmed kinds: costs written negative or positive are both read as costs (the sign
 * of each month's costs decides, as in `pnlTieOut`).
 */
export function pnlMonthlyTotals(lines: readonly { month: string; amount: string; kind: PnlKind | null }[]): PnlMonthTotals[] {
  const zero = (): Record<PnlLineKind, bigint> => ({ REVENUE: 0n, COGS: 0n, OPEX: 0n, OTHER_INCOME: 0n, OTHER_EXPENSE: 0n });
  const months = new Map<string, Record<PnlLineKind, bigint>>();
  for (const line of lines) {
    if (!line.kind || !isPnlLine(line.kind)) continue;
    const sums = months.get(line.month) ?? zero();
    sums[line.kind] += toScaled(line.amount);
    months.set(line.month, sums);
  }
  const abs = (value: bigint) => (value < 0n ? -value : value);
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, s]) => {
      const costs = abs(s.COGS);
      const opex = abs(s.OPEX);
      const otherExpense = abs(s.OTHER_EXPENSE);
      const gross = s.REVENUE - costs;
      const operating = gross - opex;
      return {
        month,
        revenue: fromScaled(s.REVENUE),
        costOfRevenue: fromScaled(costs),
        grossProfit: fromScaled(gross),
        operatingExpenses: fromScaled(opex),
        operatingIncome: fromScaled(operating),
        netIncome: fromScaled(operating + s.OTHER_INCOME - otherExpense),
      };
    });
}

// ——— The mapping assistant's proposal, checked ———

/** At or above this, a field the assistant proposes is filled in; below it, a person is asked. */
export const ASSIST_CONFIDENCE = 0.85;

/** What a group of the grid's rows is, as the assistant read it (Kumar, 2026-11-25: "how the rows are setup"). */
export type RowGroupKind = 'TITLE' | 'HEADER' | 'DATA' | 'SUBTOTAL' | 'NOTES' | 'BLANK';
export interface RowGroup {
  /** Row numbers as the grid numbers them (non-empty rows from 1). */
  readonly from: number;
  readonly to: number;
  readonly kind: RowGroupKind;
  readonly note: string;
}

/** How the assistant read the file, said back to the person before anything is mapped. Words only, never a value. */
export interface FileReading {
  readonly summary: string | null;
  readonly rowGroups: readonly RowGroup[];
}

/**
 * The assistant's row groups, checked against the grid: a group whose rows are not in the grid, runs backwards or
 * overlaps one before it is dropped, so every row number shown points at a row the person can see.
 */
export function checkRowGroups(groups: readonly RowGroup[], rowCount: number): RowGroup[] {
  const kept: RowGroup[] = [];
  for (const group of groups) {
    if (!Number.isInteger(group.from) || !Number.isInteger(group.to) || group.from < 1 || group.to < group.from || group.to > rowCount) continue;
    if ((kept.at(-1)?.to ?? 0) >= group.from) continue;
    kept.push({ from: group.from, to: group.to, kind: group.kind, note: group.note.trim().slice(0, 200) });
  }
  return kept;
}

/** What the mapping assistant proposes (already schema-validated by the prompt). */
export interface MappingProposal {
  readonly summary?: string | undefined;
  readonly rowGroups?: readonly RowGroup[] | undefined;
  readonly headerRow: number;
  readonly layout: ImportLayout;
  readonly fields: readonly { field: string; column: string | null; confidence: number; reason: string; evidence: string; guided?: boolean | undefined }[];
  readonly lineKinds: readonly { account: string; kind: PnlKind; confidence: number }[];
  readonly questions: readonly { field: string | null; question: string; options: readonly string[] }[];
}

export interface AssistPick {
  /** GUIDED: the pick follows what the person told the assistant (T-152); AI: inferred; NAME: matched by header name. */
  readonly by: 'AI' | 'NAME' | 'GUIDED';
  readonly confidence: number | null;
  readonly reason: string | null;
}

/** The assisted mapping: what is filled in, why, and what a person must answer before import. */
export interface AssistedMapping {
  readonly source: 'AI' | 'NAMES';
  readonly headerRow: number;
  readonly layout: ImportLayout;
  readonly fields: Readonly<Record<string, FieldSource>>;
  readonly picks: Readonly<Record<string, AssistPick>>;
  readonly lineKinds: Readonly<Record<string, PnlKind>>;
  /** Accounts whose kind the assistant was unsure of: shown for a person to check. */
  readonly unsureLines: readonly string[];
  readonly questions: readonly { field: string | null; question: string; options: readonly string[] }[];
  /** Said on screen when the assistant could not help ("names matched only"). */
  readonly note: string | null;
  /** What the person told the assistant about this file, quoted back on the mapping screen (T-152). */
  readonly guidance?: ImportGuidance | null;
  /** How the assistant read the file (its words, checked against the grid); absent when no assistant read it. */
  readonly reading?: FileReading | null;
}

const squash = (text: string) => text.toLowerCase().replaceAll(/\s+/g, ' ').trim();

/**
 * Turn a proposal into a mapping a person reviews. Never trusted as given:
 * - a column, label or month column the file does not have is dropped;
 * - a match by name (`byName`, from the aliases) always wins over the assistant;
 * - each column feeds one field;
 * - a pick below ASSIST_CONFIDENCE, or whose quoted evidence is not in the file, is left empty and
 *   becomes a question;
 * - the assistant never supplies a value: values are read from the cells by `applyMapping`.
 */
export function checkProposal(input: {
  definition: TargetDefinition;
  /** The table under the proposal's header row, reshaped by its layout (when the layout is valid). */
  header: readonly string[];
  /** The raw header (before reshape), for checking the layout. */
  rawHeader: readonly string[];
  /** Every cell the assistant saw. */
  preview: readonly (readonly string[])[];
  proposal: MappingProposal;
  byName: Readonly<Record<string, FieldSource>>;
  /** The person's instructions and row notes; they steer the proposal, and conflicts with the data become questions. */
  guidance?: ImportGuidance | null;
}): AssistedMapping {
  const { definition, header, rawHeader, proposal, byName } = input;
  const guidance = input.guidance ?? null;
  const layout = layoutProblems(definition, rawHeader, proposal.layout).length === 0 ? proposal.layout : ({ kind: 'ROWS' } as const);
  const cells = new Set(input.preview.flat().map(squash).filter(Boolean));
  const fields: Record<string, FieldSource> = {};
  const picks: Record<string, AssistPick> = {};
  const used = new Set<string>();
  const questions: AssistedMapping['questions'][number][] = [];

  // Layout-owned fields: the month (and, line by line, the amount) come from the reshape itself.
  if (layout.kind !== 'ROWS') {
    fields['month'] = { kind: 'column', column: PERIOD_COLUMN };
    picks['month'] = { by: 'AI', confidence: null, reason: 'Periods across the columns' };
    used.add(PERIOD_COLUMN);
  }
  if (layout.kind === 'PERIOD_COLUMNS') {
    fields['amount'] = { kind: 'column', column: VALUE_COLUMN };
    picks['amount'] = { by: 'AI', confidence: null, reason: 'The figure under each period' };
    used.add(VALUE_COLUMN);
    // The line names: what the assistant named, or else the column left of the periods. Never a question a person
    // must decode (Kumar, 2026-11-25: "Still required Account. I dont know what is Account").
    const named = proposal.fields.find((entry) => entry.field === 'account');
    const labels = header.filter((column) => column !== PERIOD_COLUMN && column !== VALUE_COLUMN);
    const column = named?.column && labels.includes(named.column) ? named.column : labels[0];
    if (definition.lineItems && column) {
      fields['account'] = { kind: 'column', column };
      picks['account'] = { by: guidance && named?.guided && named.column === column ? 'GUIDED' : 'AI', confidence: null, reason: `The line names in “${column}”` };
      used.add(column);
    }
  }
  if (layout.kind === 'ROWS') {
    for (const [field, source] of Object.entries(byName)) {
      if (source.kind !== 'column' || !header.includes(source.column) || used.has(source.column)) continue;
      fields[field] = source;
      picks[field] = { by: 'NAME', confidence: null, reason: `Column "${source.column}"` };
      used.add(source.column);
    }
  }
  for (const field of definition.fields) {
    if (fields[field.name]) continue;
    const pick = proposal.fields.find((entry) => entry.field === field.name);
    const column = pick?.column ?? null;
    const grounded = pick !== undefined && (pick.evidence.trim() === '' ? false : cells.has(squash(pick.evidence)));
    if (pick && column && header.includes(column) && !used.has(column) && pick.confidence >= ASSIST_CONFIDENCE && grounded) {
      fields[field.name] = { kind: 'column', column };
      picks[field.name] = { by: guidance && pick.guided ? 'GUIDED' : 'AI', confidence: pick.confidence, reason: pick.reason };
      used.add(column);
      continue;
    }
    fields[field.name] = { kind: 'none' };
    // Ask about a required field left empty, or one the assistant had a real (but unsure) candidate for.
    const asked = proposal.questions.find((question) => question.field === field.name);
    const options = [...new Set([...(asked?.options ?? []), ...(column ? [column] : [])])].filter((option) => header.includes(option) && !used.has(option));
    if (field.required || (column && header.includes(column))) {
      questions.push({
        field: field.name,
        question: asked?.question ?? (column && header.includes(column) ? `Is "${column}" the ${field.label.toLowerCase()}?` : `Which column is the ${field.label.toLowerCase()}?`),
        options,
      });
    }
  }
  // Questions about the file as a whole (not a field), e.g. "Two sheets look like the rent roll".
  for (const question of proposal.questions) {
    if (question.field === null) questions.push({ field: null, question: question.question, options: [] });
  }

  // A note that contradicts the data (a "subtotal" that does not add up) is asked about, never silently trusted or overridden.
  for (const conflict of subtotalConflicts(input.preview, proposal.headerRow, guidance)) questions.push({ field: null, question: conflict.question, options: [] });

  const lineKinds: Record<string, PnlKind> = {};
  const unsureLines: string[] = [];
  if (definition.lineItems) {
    for (const entry of proposal.lineKinds) {
      lineKinds[entry.account] = entry.kind;
      if (entry.confidence < ASSIST_CONFIDENCE) unsureLines.push(entry.account);
    }
  }
  const summary = proposal.summary?.trim() ?? '';
  const reading: FileReading = { summary: summary === '' ? null : summary.slice(0, 600), rowGroups: checkRowGroups(proposal.rowGroups ?? [], input.preview.length) };
  return { source: 'AI', headerRow: proposal.headerRow, layout, fields, picks, lineKinds, unsureLines, questions, note: null, guidance, reading };
}

/**
 * Without the assistant: names matched, and months across read from the header (`guessLayout`), said on
 * screen. A statement's line kinds are left for a person.
 */
export function namesOnly(definition: TargetDefinition, headerRow: number, header: readonly string[], byName: Readonly<Record<string, FieldSource>>, note: string | null): AssistedMapping {
  const layout = guessLayout(definition, header);
  const fields: Record<string, FieldSource> = layout.kind === 'ROWS' ? { ...byName } : {};
  const picks: Record<string, AssistPick> = {};
  if (layout.kind !== 'ROWS') {
    fields['month'] = { kind: 'column', column: PERIOD_COLUMN };
    picks['month'] = { by: 'NAME', confidence: null, reason: 'Periods across the columns' };
  }
  if (layout.kind === 'PERIOD_COLUMNS') {
    const label = header.find((column) => !periodOfHeader(column));
    fields['amount'] = { kind: 'column', column: VALUE_COLUMN };
    picks['amount'] = { by: 'NAME', confidence: null, reason: 'The figure under each period' };
    if (label) {
      fields['account'] = { kind: 'column', column: label };
      picks['account'] = { by: 'NAME', confidence: null, reason: `The line labels in "${label}"` };
    }
  }
  for (const [field, source] of Object.entries(fields)) if (source.kind === 'column' && !picks[field]) picks[field] = { by: 'NAME', confidence: null, reason: `Column "${source.column}"` };
  return { source: 'NAMES', headerRow, layout, fields, picks, lineKinds: {}, unsureLines: [], questions: [], note };
}

/** Accounts of a line-by-line statement that still need a kind before import. */
export function missingLineKinds(accounts: readonly string[], lineKinds: Readonly<Record<string, PnlKind>> | undefined): string[] {
  return [...new Set(accounts)].filter((account) => !lineKinds?.[account]);
}
