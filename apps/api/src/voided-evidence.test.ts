import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Voided evidence stays out of every read path (T-154, ADR 0039). Each Prisma read of
 * `evidenceItem`, and each raw SQL read of `evidence_items`, either filters with
 * `ACTIVE_EVIDENCE` / `ACTIVE_EVIDENCE_SQL` (from `@pactlab/db`) or says just above it why
 * it may see voided rows:
 *   // void-ok: <why: one item by id, so a citation still explains; ingestion identity; …>
 * A new read path that forgets fails here, so withdrawn data cannot quietly count again.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sources = ['apps/api/src', 'apps/worker/src', 'packages/db/src'].map((dir) => join(root, dir));

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

function callArguments(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')' && --depth === 0) return text.slice(open, index + 1);
  }
  return text.slice(open);
}

/** The template literal around `at` (raw SQL), or the line when there is none. */
function sqlAround(text: string, at: number): string {
  const start = text.lastIndexOf('`', at);
  const end = text.indexOf('`', at);
  return start >= 0 && end >= 0 ? text.slice(start, end) : text.slice(text.lastIndexOf('\n', at), text.indexOf('\n', at));
}

export function unfilteredReads(text: string): number[] {
  const lines = text.split('\n');
  const found: number[] = [];
  const justified = (at: number) => {
    const line = text.slice(0, at).split('\n').length;
    return /\/\/ void-ok: \S/.test(lines.slice(Math.max(0, line - 4), line).join('\n'));
  };
  for (const match of text.matchAll(/\.evidenceItem\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|groupBy|aggregate)\(/g)) {
    const at = match.index;
    if (callArguments(text, at + match[0].length - 1).includes('ACTIVE_EVIDENCE') || justified(at)) continue;
    found.push(text.slice(0, at).split('\n').length);
  }
  for (const match of text.matchAll(/\b(FROM|JOIN)\s+evidence_items\b/gi)) {
    const at = match.index;
    if (/ACTIVE_EVIDENCE_SQL|evidence_voids/.test(sqlAround(text, at)) || justified(at)) continue;
    found.push(text.slice(0, at).split('\n').length);
  }
  return found;
}

describe('voided evidence is excluded from every read path (T-154)', () => {
  it('every evidence read filters voided rows or says why it need not', () => {
    const offenders = sources.flatMap(files).flatMap((file) => unfilteredReads(readFileSync(file, 'utf8')).map((line) => `${relative(root, file)}:${line}`));
    expect(sources.flatMap(files).length).toBeGreaterThan(100);
    expect(offenders, 'Add `...ACTIVE_EVIDENCE` to the where (or `AND ${ACTIVE_EVIDENCE_SQL}`), or `// void-ok: <why>` just above.').toEqual([]);
  });

  it('recognises a filtered read, a justified one and an unfiltered one', () => {
    expect(unfilteredReads(`tx.evidenceItem.findMany({ where: { dealId, ...ACTIVE_EVIDENCE } })`)).toEqual([]);
    expect(unfilteredReads(`// void-ok: one item by id\ntx.evidenceItem.findFirst({ where: { id } })`)).toEqual([]);
    expect(unfilteredReads('x\ntx.evidenceItem.count({ where: { dealId } })')).toEqual([2]);
    expect(unfilteredReads('const q = `SELECT 1 FROM evidence_items WHERE deal_id = $1`;')).toEqual([1]);
    expect(unfilteredReads('const q = `SELECT 1 FROM evidence_items WHERE ${ACTIVE_EVIDENCE_SQL}`;')).toEqual([]);
  });
});
