import { formatScaled, parseAmount } from './decimal';

/**
 * The conversion audit (T-178, Kumar 2026-11-26): converting is not trusting. The original is re-read
 * independently of the converted text (for scans, the vision lane reads the source image; for native
 * files, the embedded text layer) and the two readings are compared, deterministically.
 *
 * Two failures are kept apart:
 * - a CONVERSION MISMATCH (converted figure ≠ original figure, a dropped page, a lost table) is an error
 *   and blocks ready until the conversion is fixed or re-run;
 * - a SOURCE DISCREPANCY (the original itself does not foot) is the seller's document being internally
 *   inconsistent: it travels as a noted gap and becomes diligence signal at injection.
 */
export const RINSE_AUDIT_VERSION = 'rinse-audit-1';

export interface Figure {
  readonly label: string;
  /** Plain decimal string ("1234.5"). */
  readonly value: string;
  readonly page: number;
}

export interface Table {
  readonly page: number;
  readonly rows: readonly Figure[];
  /** The stated total, when the table states one. */
  readonly total: Figure | null;
}

/** What one reading of a document holds: the figures, tables, dates and parties it states, page by page. */
export interface DocumentReading {
  readonly pages: number;
  readonly figures: readonly Figure[];
  readonly tables: readonly Table[];
  readonly dates: readonly string[];
  readonly parties: readonly string[];
}

const FIGURE_LINE = /^(?<label>[\p{L}][^:\t]*?)\s*(?::|\t|\s{2,})\s*(?<amount>(?:[A-Z]{3}\s+)?[($£€¥₹-]*\s*\d[\d,]*(?:\.\d+)?\)?)\s*$/u;
const TOTAL_LABEL = /^(sub)?total\b|\btotal$/i;
const DATE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})\b/g;
const PARTY = /\b([A-Z][\p{L}&.'-]*(?:\s+[A-Z][\p{L}&.'-]*)*\s+(?:Inc\.|LLC|Ltd\.?|Limited|GmbH|S\.A\.|plc|LLP|Corp\.?))/gu;

export function labelKey(label: string): string {
  return label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Read a document's pages deterministically: every "Label: amount" line is a figure; consecutive figure
 * lines ending in a "Total …" line are a table whose total is that line. Model output is never parsed
 * for money — the vision lane's transcription is read by this same code.
 */
export function readDocument(pageTexts: readonly string[]): DocumentReading {
  const figures: Figure[] = [];
  const tables: Table[] = [];
  const dates = new Set<string>();
  const parties = new Set<string>();
  pageTexts.forEach((text, index) => {
    const page = index + 1;
    let run: Figure[] = [];
    for (const line of text.split(/\r?\n/)) {
      for (const match of line.matchAll(DATE)) dates.add(match[1] ?? '');
      for (const match of line.matchAll(PARTY)) parties.add((match[1] ?? '').trim());
      const found = FIGURE_LINE.exec(line.trim());
      const value = found?.groups ? parseAmount(found.groups['amount'] ?? '') : null;
      if (!found?.groups || value === null) {
        run = [];
        continue;
      }
      const figure: Figure = { label: (found.groups['label'] ?? '').trim(), value: formatScaled(value), page };
      figures.push(figure);
      if (TOTAL_LABEL.test(figure.label)) {
        if (run.length >= 2) tables.push({ page, rows: run, total: figure });
        run = [];
      } else {
        run.push(figure);
      }
    }
  });
  return { pages: pageTexts.length, figures, tables, dates: [...dates], parties: [...parties] };
}

export interface FootingResult {
  readonly page: number;
  readonly totalLabel: string;
  readonly stated: string;
  readonly computed: string;
  readonly foots: boolean;
}

/** Line items must sum to the stated total, exactly. */
export function footTable(table: Table): FootingResult | null {
  if (!table.total) return null;
  const computed = table.rows.reduce((sum, row) => sum + (parseAmount(row.value) ?? 0n), 0n);
  const stated = parseAmount(table.total.value) ?? 0n;
  return { page: table.page, totalLabel: table.total.label, stated: formatScaled(stated), computed: formatScaled(computed), foots: computed === stated };
}

export interface AuditMismatch {
  readonly kind: 'FIGURE' | 'PAGE_COUNT' | 'TABLE_MISSING' | 'FIGURE_MISSING' | 'DATE' | 'PARTY' | 'FOOTING';
  readonly label: string;
  /** What the original says, and on which page. */
  readonly original: { readonly value: string; readonly page: number | null };
  /** What the conversion says, and on which page (null when the conversion lost it). */
  readonly converted: { readonly value: string | null; readonly page: number | null };
}

export interface SourceDiscrepancy {
  readonly label: string;
  readonly page: number;
  readonly stated: string;
  readonly computed: string;
}

export interface ConversionAudit {
  readonly version: typeof RINSE_AUDIT_VERSION;
  readonly figuresCompared: number;
  readonly figuresMatched: number;
  readonly pages: { readonly original: number; readonly converted: number };
  readonly tables: { readonly original: number; readonly converted: number };
  /** Errors: block ready until the conversion is fixed or re-run. */
  readonly mismatches: readonly AuditMismatch[];
  /** The original does not foot: travels as a noted gap. */
  readonly sourceDiscrepancies: readonly SourceDiscrepancy[];
}

/**
 * Compare the original's independent reading with the converted document's reading: key figures and
 * totals, dates and party names, page-count parity and table presence; and foot every table on both sides.
 */
export function auditConversion(original: DocumentReading, converted: DocumentReading): ConversionAudit {
  const mismatches: AuditMismatch[] = [];
  const convertedByLabel = new Map<string, Figure[]>();
  for (const figure of converted.figures) {
    const key = labelKey(figure.label);
    convertedByLabel.set(key, [...(convertedByLabel.get(key) ?? []), figure]);
  }
  let matched = 0;
  const used = new Map<string, number>();
  for (const figure of original.figures) {
    const key = labelKey(figure.label);
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const counterpart = convertedByLabel.get(key)?.[index];
    if (!counterpart) {
      mismatches.push({ kind: 'FIGURE_MISSING', label: figure.label, original: { value: figure.value, page: figure.page }, converted: { value: null, page: null } });
    } else if (counterpart.value !== figure.value) {
      mismatches.push({ kind: 'FIGURE', label: figure.label, original: { value: figure.value, page: figure.page }, converted: { value: counterpart.value, page: counterpart.page } });
    } else {
      matched += 1;
    }
  }
  if (original.pages !== converted.pages) {
    mismatches.push({ kind: 'PAGE_COUNT', label: 'Pages', original: { value: String(original.pages), page: null }, converted: { value: String(converted.pages), page: null } });
  }
  const convertedTotals = new Set(converted.tables.map((table) => labelKey(table.total?.label ?? '')));
  for (const table of original.tables) {
    if (!convertedTotals.has(labelKey(table.total?.label ?? ''))) {
      mismatches.push({ kind: 'TABLE_MISSING', label: table.total?.label ?? 'Table', original: { value: table.total?.value ?? '', page: table.page }, converted: { value: null, page: null } });
    }
  }
  const convertedDates = new Set(converted.dates);
  for (const date of original.dates) {
    if (!convertedDates.has(date)) mismatches.push({ kind: 'DATE', label: 'Date', original: { value: date, page: null }, converted: { value: null, page: null } });
  }
  const convertedParties = new Set(converted.parties.map(labelKey));
  for (const party of original.parties) {
    if (!convertedParties.has(labelKey(party))) mismatches.push({ kind: 'PARTY', label: 'Party', original: { value: party, page: null }, converted: { value: null, page: null } });
  }
  // Footing: a table that foots in the original but not in the conversion is the conversion's error.
  const sourceDiscrepancies: SourceDiscrepancy[] = [];
  const originalFooting = new Map<string, FootingResult>();
  for (const table of original.tables) {
    const footing = footTable(table);
    if (!footing) continue;
    originalFooting.set(labelKey(footing.totalLabel), footing);
    if (!footing.foots) sourceDiscrepancies.push({ label: footing.totalLabel, page: footing.page, stated: footing.stated, computed: footing.computed });
  }
  for (const table of converted.tables) {
    const footing = footTable(table);
    if (!footing || footing.foots) continue;
    const before = originalFooting.get(labelKey(footing.totalLabel));
    if (before && !before.foots) continue; // The source does not foot either: a discrepancy, already noted.
    // Side by side: the original's stated total against the conversion's, which its own lines do not reach.
    mismatches.push({ kind: 'FOOTING', label: footing.totalLabel, original: { value: before?.stated ?? footing.computed, page: before?.page ?? null }, converted: { value: footing.stated, page: footing.page } });
  }
  return {
    version: RINSE_AUDIT_VERSION,
    figuresCompared: original.figures.length,
    figuresMatched: matched,
    pages: { original: original.pages, converted: converted.pages },
    tables: { original: original.tables.length, converted: converted.tables.length },
    mismatches,
    sourceDiscrepancies,
  };
}
