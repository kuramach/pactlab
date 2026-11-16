import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Lists are paginated (T-126, CLAUDE.md). Every Prisma `findMany` either takes a page
 * (`take:`, from the shared keyset helpers in `packages/db/src/pagination.ts`) or says, just above
 * it, why it may read every row:
 *   // bounded: <why it cannot grow without limit: e.g. one pact's closing checklist, ids from a page>
 *   // whole-set: <why a calculation needs every row; the rows are never returned as a list>
 * The unpaged reads that existed when the rule came in are counted per file in
 * `pagination-baseline.json`. That count may only fall: a new unpaged read fails here, and a fixed
 * one must lower the baseline (run with UPDATE_PAGINATION_BASELINE=1 to rewrite it).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sources = ['apps/api/src', 'apps/worker/src', 'packages/db/src'].map((dir) => join(root, dir));
const baselinePath = join(dirname(fileURLToPath(import.meta.url)), 'pagination-baseline.json');

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ['node_modules', 'testing', 'generated', 'seed'].includes(name) ? [] : files(path);
    return /\.ts$/.test(name) && !/\.test\.ts$|testing\.ts$/.test(name) ? [path] : [];
  });
}

/** The argument text of the call that opens at `open` (the index of its "("). */
function callArguments(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')' && --depth === 0) return text.slice(open, index + 1);
  }
  return text.slice(open);
}

export function unpagedReads(text: string): number[] {
  const lines = text.split('\n');
  const found: number[] = [];
  for (const match of text.matchAll(/\.findMany\(/g)) {
    const at = match.index;
    if (/\btake\s*:/.test(callArguments(text, at + match[0].length - 1))) continue;
    const line = text.slice(0, at).split('\n').length;
    const context = lines.slice(Math.max(0, line - 4), line).join('\n');
    if (/\/\/ (bounded|whole-set): \S/.test(context)) continue;
    found.push(line);
  }
  return found;
}

describe('lists are paginated (T-126)', () => {
  it('an unpaged read needs a stated bound; the ones from before the rule may only go down', () => {
    const counts: Record<string, number> = {};
    for (const file of sources.flatMap(files)) {
      const lines = unpagedReads(readFileSync(file, 'utf8'));
      if (lines.length > 0) counts[relative(root, file)] = lines.length;
    }
    expect(sources.flatMap(files).length).toBeGreaterThan(100);
    if (process.env['UPDATE_PAGINATION_BASELINE'] === '1') writeFileSync(baselinePath, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>;
    const grew = Object.entries(counts).filter(([file, count]) => count > (baseline[file] ?? 0)).map(([file, count]) => `${file}: ${count} unpaged (baseline ${baseline[file] ?? 0})`);
    expect(grew, 'Page it (`take:` via packages/db/src/pagination.ts), or add `// bounded: <why>` or `// whole-set: <why>` just above.').toEqual([]);
    const fell = Object.entries(baseline).filter(([file, count]) => (counts[file] ?? 0) < count).map(([file]) => file);
    expect(fell, 'Fewer unpaged reads than the baseline: lower it (UPDATE_PAGINATION_BASELINE=1).').toEqual([]);
  });

  it('recognises a page, a stated bound, and an unpaged read', () => {
    expect(unpagedReads(`tx.a.findMany({ where: {}, take: limit + 1 })`)).toEqual([]);
    expect(unpagedReads(`// bounded: one pact's checklist\ntx.a.findMany({ where: { dealId } })`)).toEqual([]);
    expect(unpagedReads(`// whole-set: the engineering report sums every contributor\ntx.a.findMany({ where: { dealId } })`)).toEqual([]);
    expect(unpagedReads(`x\ntx.a.findMany({ where: { dealId }, orderBy: { id: 'asc' } })`)).toEqual([2]);
  });
});
