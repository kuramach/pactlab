import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One button style everywhere (batch 1): screens use `Button` / `buttonVariants`
 * from @pactlab/ui. These few controls are deliberately custom — the floating
 * bug button, filter chips, the quote-line picker, sort headers and menu items.
 */
const ALLOWED: Readonly<Record<string, number>> = {
  'app/(app)/_lib/bugs/bug-reporter.tsx': 1,
  'app/(app)/_lib/topbar.tsx': 1,
  'app/(app)/deals/[dealId]/documents/review-queue.tsx': 1,
  'app/(app)/deals/[dealId]/documents/library.tsx': 1,
  'app/(app)/deals/[dealId]/valuation/balance-sheet-form.tsx': 1,
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '.next' ? [] : files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe('buttons (batch 1)', () => {
  it('uses the shared Button everywhere except the allowed custom controls', () => {
    const root = join(__dirname, '..');
    const found: Record<string, number> = {};
    for (const file of files(join(root, 'app'))) {
      const count = (readFileSync(file, 'utf8').match(/<button\b/g) ?? []).length;
      if (count > 0) found[relative(root, file)] = count;
    }
    expect(found).toEqual(ALLOWED);
  });
});
