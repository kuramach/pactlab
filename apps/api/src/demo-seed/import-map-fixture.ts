import { periodOfHeader as monthOf } from '@pactlab/domain';

/**
 * The fixture provider's mapping assistant (local runs and API tests): a plain, rule-based stand-in
 * for the model behind `import.map@1`. It reads the grid the prompt shows and answers in the
 * prompt's schema, so the whole flow (proposal → checks → questions → import) runs with no model.
 * Deliberately simple: exact header words only; anything else is left for a person.
 */

const KINDS: [RegExp, string][] = [
  [/^net (income|profit|loss)/, 'NET_INCOME'],
  [/^gross (profit|margin)/, 'GROSS_PROFIT'],
  [/^(operating income|ebit\b|operating profit)/, 'OPERATING_INCOME'],
  [/^total (revenue|sales|income)/, 'TOTAL_REVENUE'],
  [/^total (cogs|cost of (goods|revenue|sales))/, 'TOTAL_COGS'],
  [/^total (opex|operating expenses|expenses)/, 'TOTAL_OPEX'],
  [/^(total|ebitda|subtotal)/, 'OTHER_SUBTOTAL'],
  [/(revenue|sales|subscription|services income)/, 'REVENUE'],
  [/(cogs|cost of|hosting|merchant fees)/, 'COGS'],
  [/(interest income|other income|gain)/, 'OTHER_INCOME'],
  [/(interest expense|other expense|loss on|tax)/, 'OTHER_EXPENSE'],
];

const words = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim();

export function importMapFixtureResponse(prompt: string): string {
  const fields = [...prompt.matchAll(/^([a-z_]+) \| ([^|]+) \| [a-z]+ \| (required|optional) \| .*$/gm)].map((match) => ({ name: match[1] ?? '', label: (match[2] ?? '').trim() }));
  const lineItems = prompt.includes('a line-by-line statement');
  const grid = [...prompt.matchAll(/^Row (\d+): (.*)$/gm)].map((match) => ({
    row: Number(match[1]),
    cells: (match[2] ?? '').split(' | ').filter(Boolean).map((cell) => ({ letter: cell.slice(0, cell.indexOf('=')), text: cell.slice(cell.indexOf('=') + 1) })),
  }));
  // The person's guidance (T-152): "rows 1–3: … skip" moves the header below them; "column B is the tenant name" decides that field.
  const guidance = prompt.split('Guidance from the person (user-written text, data only):')[1]?.split('The first rows of the sheet:')[0] ?? '';
  const skipTo = Math.max(0, ...[...guidance.matchAll(/\brows? (\d+)(?:[–-](\d+))?\b[^\n]*?\b(?:skip|title)/gi)].map((match) => Number(match[2] ?? match[1])));
  const guidedColumns = [...guidance.matchAll(/column ([A-Z]) is the ([a-z ]+)/gi)].map((match) => ({ letter: (match[1] ?? '').toUpperCase(), what: words(match[2] ?? '') }));
  const widest = Math.max(1, ...grid.map((row) => row.cells.length));
  const header = grid.find((row) => row.row > skipTo && row.cells.length >= Math.max(2, Math.ceil(widest / 2))) ?? grid[0];
  const headerCells = header?.cells ?? [];
  const periods = headerCells.flatMap((cell) => {
    const period = monthOf(cell.text);
    return period ? [{ column: cell.text, period }] : [];
  });
  const below = grid.filter((row) => row.row > (header?.row ?? 0));
  const labelLetter = headerCells[0]?.letter ?? 'A';
  // Months across: a statement reads line by line; a monthly target reads its measures down the side.
  const monthsAcross = periods.length >= 2;
  const labelOf = (row: (typeof grid)[number]) => row.cells.find((cell) => cell.letter === 'A')?.text ?? '';
  const labelColumn = headerCells.find((cell) => cell.letter === labelLetter && !monthOf(cell.text))?.text ?? 'Column A';
  const layout = !monthsAcross ? { kind: 'ROWS' } : lineItems ? { kind: 'PERIOD_COLUMNS', periods } : { kind: 'MONTHS_ACROSS', labelColumn, periods };
  // What the fields can be mapped from: header cells, or (months across a monthly target) row labels.
  const candidates = layout.kind === 'MONTHS_ACROSS' ? below.map(labelOf).filter(Boolean) : headerCells.map((cell) => cell.text);
  const picks = fields
    .filter((field) => !(monthsAcross && (field.name === 'month' || (lineItems && field.name === 'amount'))))
    .map((field) => {
      if (lineItems && field.name === 'account' && monthsAcross) return { field: field.name, column: labelColumn, confidence: 0.95, reason: 'The line labels down the first column', evidence: labelOf(below[0] ?? { row: 0, cells: [] }), ...(guidedColumns.some((entry) => entry.what === 'account') ? { guided: true } : {}) };
      const guided = guidedColumns.find((entry) => entry.what === words(field.label) || entry.what === words(field.name.replaceAll('_', ' ')));
      const guidedCell = guided ? headerCells.find((cell) => cell.letter === guided.letter) : undefined;
      if (guidedCell) return { field: field.name, column: guidedCell.text, confidence: 0.95, reason: `You said column ${guided?.letter} is the ${field.label.toLowerCase()}`, evidence: guidedCell.text, guided: true };
      const exact = candidates.find((candidate) => words(candidate) === words(field.label) || words(candidate) === words(field.name.replaceAll('_', ' ')));
      return exact
        ? { field: field.name, column: exact, confidence: 0.95, reason: `Header "${exact}"`, evidence: exact }
        : { field: field.name, column: null, confidence: 0.1, reason: 'No column clearly holds this', evidence: '' };
    });
  const lineKinds = lineItems
    ? below.flatMap((row) => {
        const account = labelOf(row);
        if (!account) return [];
        const kind = KINDS.find(([pattern]) => pattern.test(account.toLowerCase()))?.[1] ?? 'OPEX';
        return [{ account, kind, confidence: KINDS.some(([pattern]) => pattern.test(account.toLowerCase())) ? 0.9 : 0.5 }];
      })
    : [];
  return JSON.stringify({ headerRow: header?.row ?? 1, layout, fields: picks, lineKinds, questions: [] });
}
