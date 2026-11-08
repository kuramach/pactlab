/**
 * Rows for chart labels that would otherwise overlap (batch 2): labels sorted by
 * position; each goes in the first row whose last label is at least `minGap`
 * away, else a new row. Same input, same rows.
 */
export function labelRows(positions: readonly number[], minGap: number): number[] {
  const order = positions.map((position, index) => ({ position, index })).sort((a, b) => a.position - b.position || a.index - b.index);
  const lastInRow: number[] = [];
  const rows = new Array<number>(positions.length).fill(0);
  for (const { position, index } of order) {
    let row = lastInRow.findIndex((last) => position - last >= minGap);
    if (row === -1) row = lastInRow.length;
    lastInRow[row] = position;
    rows[index] = row;
  }
  return rows;
}
