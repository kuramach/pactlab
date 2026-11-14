import { execFileSync } from 'node:child_process';

/**
 * The de-flake work queue (T-113 part 1): tests that passed on retry, or failed, across recent CI runs,
 * most frequent first. Reads the e2e job logs with the GitHub CLI (`gh auth login` first).
 *   pnpm --filter @pactlab/e2e flaky:history [runs=60]
 */
const runs = Number(process.argv[2] ?? 60);
const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const tally = new Map<string, { flaky: number; failed: number }>();
let scanned = 0;
for (const workflow of ['ci.yml', 'e2e-full.yml']) {
  const ids = JSON.parse(gh('run', 'list', '--workflow', workflow, '--limit', String(runs), '--json', 'databaseId')) as { databaseId: number }[];
  for (const { databaseId } of ids) {
    let log: string;
    try {
      log = gh('run', 'view', String(databaseId), '--log');
    } catch {
      continue;
    }
    scanned += 1;
    // Playwright's summary lists flaky and failed tests by name under their counts.
    const lines = log.split('\n').map((line) => line.replace(/^.*?Z /, ''));
    let section: 'flaky' | 'failed' | null = null;
    for (const line of lines) {
      if (/^\s+\d+ flaky\s*$/.test(line)) section = 'flaky';
      else if (/^\s+\d+ failed\s*$/.test(line)) section = 'failed';
      else if (/^\s+\d+ (passed|skipped|did not run)/.test(line) || line.trim() === '') section = null;
      else if (section && /\[chromium\] ›/.test(line)) {
        const name = line.trim().replace(/^\[chromium\] › /, '').replace(/:\d+:\d+ ›/, ' ›');
        const entry = tally.get(name) ?? { flaky: 0, failed: 0 };
        entry[section] += 1;
        tally.set(name, entry);
      }
    }
  }
}
const queue = [...tally.entries()].sort((a, b) => b[1].flaky + b[1].failed - (a[1].flaky + a[1].failed));
process.stdout.write(`Scanned ${scanned} runs.\n`);
for (const [name, counts] of queue) process.stdout.write(`${String(counts.flaky).padStart(3)} flaky ${String(counts.failed).padStart(3)} failed  ${name}\n`);
if (queue.length === 0) process.stdout.write('No flaky or failed tests in these runs.\n');
