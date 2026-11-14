import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

/**
 * Flaky visibility (T-113 part 1): every test that failed and then passed on a retry is a flaky
 * test, whatever the run's colour. They are listed at the end of the run, in `test-results/flaky.json`,
 * and in the GitHub job summary, so each one becomes a quarantine-or-fix decision (`QUARANTINE.md`).
 */
export default class FlakyReporter implements Reporter {
  private root: Suite | null = null;

  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite;
  }

  onEnd(_result: FullResult): void {
    const flaky: { id: string; file: string; title: string; retries: number }[] = (this.root?.allTests() ?? [])
      .filter((test: TestCase) => test.outcome() === 'flaky')
      .map((test) => ({ id: test.id, file: test.location.file.split('/apps/e2e/')[1] ?? test.location.file, title: test.titlePath().slice(3).join(' › '), retries: test.results.length - 1 }));
    const out = join(process.cwd(), 'test-results', 'flaky.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ count: flaky.length, tests: flaky }, null, 2)}\n`);
    if (flaky.length === 0) {
      process.stdout.write('\nFlaky (passed on retry): none\n');
    } else {
      process.stdout.write(`\nFlaky (passed on retry): ${flaky.length}. Quarantine or fix each one today (apps/e2e/QUARANTINE.md):\n`);
      for (const test of flaky) process.stdout.write(`  - ${test.file} › ${test.title} (${test.retries} retr${test.retries === 1 ? 'y' : 'ies'})\n`);
    }
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) {
      const rows = flaky.map((test) => `| \`${test.file}\` | ${test.title.replaceAll('|', '\\|')} | ${test.retries} |`);
      appendFileSync(
        summary,
        flaky.length === 0
          ? '### Flaky tests\n\nNone: every test passed on its first try.\n'
          : `### Flaky tests (passed on retry): ${flaky.length}\n\nEach one leaves the gate today: quarantine it (\`apps/e2e/QUARANTINE.md\`) or fix it.\n\n| Spec | Test | Retries |\n|---|---|---|\n${rows.join('\n')}\n`,
      );
    }
  }
}
