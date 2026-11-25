import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One approved pattern per kind of UI (Kumar, 2026-11-25; docs/ui-patterns.md). Anything that steps through items
 * one at a time ("2 of 5", Back and Next) is built from the shared StepPanel, the guided tour's design, never a
 * look-alike: a carousel of its own, or controls outside the panel.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '.next' ? [] : files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Not steppers, and why: each is listed here deliberately, never to get round the rule. */
const NOT_STEPPERS: Readonly<Record<string, string>> = {
  // Moves between a document's own pages and quoted pages: the viewer's page navigation, like the Pager.
  'app/(app)/deals/[dealId]/documents/page.tsx': 'document page navigation',
};

// A position counter in the markup: "{index + 1} of {steps.length}" or `${index + 1} of ${cards.length}`.
const COUNTER = /\{\s*\w+\s*\+\s*1\s*\}\s*of\s*\{|\$\{\s*\w+\s*\+\s*1\s*\}\s*of\s*\$\{/;

describe('approved UI patterns', () => {
  it('every stepper uses the shared StepPanel, and no screen builds a carousel of its own', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of files(join(root, 'app'))) {
      const text = readFileSync(file, 'utf8');
      const stepper = COUNTER.test(text) && /\b(Back|Previous|Next)\b/.test(text);
      const path = relative(root, file);
      if (NOT_STEPPERS[path]) continue;
      if ((stepper && !text.includes('StepPanel')) || /aria-roledescription="carousel"/.test(text)) offenders.push(path);
    }
    expect(offenders, 'Build it from StepPanel (@pactlab/ui); see docs/ui-patterns.md').toEqual([]);
  });

  it('the tour and What’s new are built from it', () => {
    const root = join(__dirname, '..');
    for (const file of ['app/(app)/deals/_lib/showcase.tsx', 'app/(app)/_lib/feature-cards/carousel.tsx']) expect(readFileSync(join(root, file), 'utf8')).toContain('<StepPanel');
  });
});
