/**
 * Import guidance (T-152): what a person tells the mapping assistant about a file before it reads it.
 * Free text for the whole file, plus notes on rows or ranges of rows ("row 14 is a subtotal"). It steers
 * which row is the header, which column feeds which field and what a line is; it never changes a value,
 * and the deterministic checks (`pnlTieOut`, `subtotalConflicts`) still run over whatever it says.
 * Rows are numbered as the mapping screen shows them: among the sheet's non-empty rows, from 1.
 */
export const GUIDANCE_MAX_TEXT = 1000;
export const GUIDANCE_MAX_NOTE = 300;
export const GUIDANCE_MAX_ANNOTATIONS = 20;
export const GUIDANCE_MAX_ROW = 30;

/** One-click starters for the instruction field. */
export const GUIDANCE_STARTERS = [
  'First row is not a header',
  'This is a rent roll, one row per unit',
  'Amounts are monthly',
  'Amounts are annual',
] as const;

export interface RowAnnotation {
  /** First row of the range, 1-based. */
  readonly fromRow: number;
  /** Last row of the range, inclusive (the same as `fromRow` for one row). */
  readonly toRow: number;
  readonly note: string;
}

export interface ImportGuidance {
  readonly instructions: string;
  readonly annotations: readonly RowAnnotation[];
}

export const EMPTY_GUIDANCE: ImportGuidance = { instructions: '', annotations: [] };

const clean = (text: string, max: number) => text.replaceAll(/\s+/g, ' ').trim().slice(0, max);

/**
 * A guidance value made safe to store and send: text squashed and capped, ranges ordered and held to
 * the rows the assistant sees, empty notes dropped, identical ranges merged. Null when nothing is left.
 */
export function normalizeGuidance(input: { instructions?: string | null; annotations?: readonly RowAnnotation[] | null } | null | undefined): ImportGuidance | null {
  const instructions = clean(input?.instructions ?? '', GUIDANCE_MAX_TEXT);
  const byRange = new Map<string, RowAnnotation>();
  for (const entry of input?.annotations ?? []) {
    const note = clean(entry.note, GUIDANCE_MAX_NOTE);
    const low = Math.min(entry.fromRow, entry.toRow);
    const high = Math.max(entry.fromRow, entry.toRow);
    if (note === '' || !Number.isInteger(low) || !Number.isInteger(high) || high < 1 || low > GUIDANCE_MAX_ROW) continue;
    const fromRow = Math.max(1, low);
    const toRow = Math.min(GUIDANCE_MAX_ROW, high);
    const key = `${fromRow}-${toRow}`;
    const earlier = byRange.get(key);
    byRange.set(key, { fromRow, toRow, note: earlier ? clean(`${earlier.note}; ${note}`, GUIDANCE_MAX_NOTE) : note });
  }
  const annotations = [...byRange.values()].sort((a, b) => a.fromRow - b.fromRow || a.toRow - b.toRow).slice(0, GUIDANCE_MAX_ANNOTATIONS);
  return instructions === '' && annotations.length === 0 ? null : { instructions, annotations };
}

/** "row 14" or "rows 1–3". */
export const rangeLabel = (entry: Pick<RowAnnotation, 'fromRow' | 'toRow'>) => (entry.fromRow === entry.toRow ? `row ${entry.fromRow}` : `rows ${entry.fromRow}–${entry.toRow}`);

/** The guidance as the assistant reads it, one line per instruction; user content, so the prompt quotes it as data. */
export function renderGuidance(guidance: ImportGuidance | null): string {
  if (!guidance) return '';
  const lines = guidance.instructions ? [`About the file: ${guidance.instructions}`] : [];
  for (const entry of guidance.annotations) lines.push(`${rangeLabel(entry)}: ${entry.note}`);
  return lines.join('\n');
}

/** Whether an annotation says its rows are a subtotal or total (not data). */
export const isSubtotalNote = (note: string) => /\b(sub-?\s?totals?|totals?)\b/i.test(note);

/** Cell text as an exact scaled integer (two decimals past the point kept as six), null when it is not a number. */
function scaled(cell: string): bigint | null {
  const text = cell.trim();
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  const digits = text.replaceAll(/[\s$€£(),+-]/g, '');
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const [whole = '0', fraction = ''] = digits.split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
  return negative ? -value : value;
}

/** A cent: a subtotal must add up, so ids that happen to be one apart do not pass for a tie. */
const TOLERANCE = 10_000n;

/**
 * Check each row annotated as a subtotal against the rows above it, down to the header: the row must
 * add up, in at least one numeric column, the numbers over it. When it does not, the person's note and
 * the data disagree and a question is returned instead of either being trusted. Rows outside the
 * grid the assistant saw cannot be checked and are left alone.
 */
export function subtotalConflicts(preview: readonly (readonly string[])[], headerRow: number, guidance: ImportGuidance | null): { question: string }[] {
  const conflicts: { question: string }[] = [];
  for (const entry of guidance?.annotations ?? []) {
    if (!isSubtotalNote(entry.note)) continue;
    for (let row = entry.fromRow; row <= entry.toRow; row += 1) {
      const cells = preview[row - 1];
      if (!cells || row <= headerRow) continue;
      let numeric = 0;
      let ties = false;
      cells.forEach((cell, at) => {
        const stated = scaled(cell);
        if (stated === null) return;
        numeric += 1;
        let sum = 0n;
        let seen = 0;
        for (let above = headerRow + 1; above < row; above += 1) {
          if (above >= entry.fromRow && above <= entry.toRow) continue;
          const value = scaled(preview[above - 1]?.[at] ?? '');
          if (value === null) continue;
          sum += value;
          seen += 1;
        }
        const gap = sum - stated;
        if (seen > 0 && (gap < 0n ? -gap : gap) <= TOLERANCE) ties = true;
      });
      if (numeric > 0 && !ties) {
        conflicts.push({ question: `You said row ${row} is a subtotal, but its numbers do not add up the rows above it. Is row ${row} a subtotal, or is it data?` });
      }
    }
  }
  return conflicts;
}
