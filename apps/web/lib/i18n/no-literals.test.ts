import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from './literals-baseline.json';
import { findLiterals } from './literals';

/**
 * No user-facing literal outside the catalog (T-172). Every TSX file in the app and in packages/ui is scanned for
 * JSX text, string literals placed in JSX and read attributes (title, label, placeholder, aria-label…). A file not
 * in `literals-baseline.json` must have none: new screens are written against `apps/web/messages`. A file in the
 * baseline may only go down, and the baseline is lowered with it, so moving copy into the catalog is never undone.
 * `UPDATE_LITERALS_BASELINE=1 pnpm --filter @pactlab/web test` rewrites the baseline, and it may only shrink.
 */
const ROOT = join(__dirname, '..', '..', '..', '..');
const SCANNED = ['apps/web/app', 'apps/web/lib', 'packages/ui/src'];

/** The pilot surface (the pact home and findings) and the shared pieces it renders: never any literal. */
const PILOT = [
  'apps/web/app/(app)/deals/[dealId]/page.tsx',
  'apps/web/app/(app)/deals/[dealId]/layout.tsx',
  'apps/web/app/(app)/deals/[dealId]/findings/page.tsx',
  'apps/web/app/(app)/deals/[dealId]/findings/[findingId]/page.tsx',
  'apps/web/app/(app)/deals/_lib/deal-tabs.tsx',
  'apps/web/app/(app)/deals/_lib/finding-evidence.tsx',
  'apps/web/app/(app)/deals/_lib/outcome.tsx',
  'apps/web/app/(app)/deals/_lib/pipeline.tsx',
  'apps/web/app/(app)/deals/_lib/seller-claims.tsx',
  'apps/web/app/(app)/deals/_lib/source-withdrawn.tsx',
  'apps/web/app/(app)/deals/_lib/states.tsx',
  'apps/web/app/_components/pager.tsx',
  'apps/web/app/(app)/settings/language-card.tsx',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '.next' ? [] : files(path);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

function counts(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const file of SCANNED.flatMap((dir) => files(join(ROOT, dir)))) {
    const found = findLiterals(readFileSync(file, 'utf8'), file).length;
    if (found > 0) result[relative(ROOT, file)] = found;
  }
  return result;
}

describe('no user-facing literals outside the catalog', () => {
  const now = counts();
  const recorded = baseline as Record<string, number>;

  it('keeps the pilot surface entirely in the catalog', () => {
    expect(PILOT.filter((file) => now[file]).map((file) => `${file}: ${now[file]}`)).toEqual([]);
  });

  it('adds no literal to any file, and never more than a file had', () => {
    const grown = Object.entries(now)
      .filter(([file, count]) => count > (recorded[file] ?? 0))
      .map(([file, count]) => {
        const sample = findLiterals(readFileSync(join(ROOT, file), 'utf8'), file).slice(0, 3).map((literal) => `line ${literal.line}: "${literal.text}"`);
        return `${file}: ${count} (allowed ${recorded[file] ?? 0}) — ${sample.join('; ')}`;
      });
    expect(grown, 'Put the words in apps/web/messages and read them through getI18n()').toEqual([]);
  });

  it('lowers the baseline as copy moves into the catalog', () => {
    if (process.env['UPDATE_LITERALS_BASELINE'] === '1') {
      const lowered = Object.fromEntries(Object.entries(recorded).flatMap(([file, count]) => (now[file] ? [[file, Math.min(count, now[file])]] : [])));
      writeFileSync(join(__dirname, 'literals-baseline.json'), `${JSON.stringify(lowered, null, 2)}\n`);
      return;
    }
    const stale = Object.entries(recorded)
      .filter(([file, count]) => (now[file] ?? 0) < count)
      .map(([file, count]) => `${file}: ${count} → ${now[file] ?? 0}`);
    expect(stale, 'Run UPDATE_LITERALS_BASELINE=1 pnpm --filter @pactlab/web test to lower the baseline').toEqual([]);
  });
});
