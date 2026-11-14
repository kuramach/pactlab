import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The quarantine register, checked (T-113 part 1). Every test tagged `@quarantine` is listed in
 * `quarantine.json` with an owner, a reason and a fix-or-delete date; no date is past or more than
 * 10 working days after the day it was quarantined; at most 8 at once; nothing listed is untagged.
 * Also: every test is tagged @smoke or @regression.
 * Prints the number quarantined (CI uses it to skip the quarantine job when it is zero).
 */
interface Entry {
  spec: string;
  title: string;
  owner: string;
  reason: string;
  quarantinedOn: string;
  fixBy: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const register = JSON.parse(readFileSync(join(root, 'quarantine.json'), 'utf8')) as { tests: Entry[] };
const today = new Date().toISOString().slice(0, 10);
const problems: string[] = [];

function workingDaysBetween(from: string, to: string): number {
  let days = 0;
  for (const day = new Date(`${from}T00:00:00Z`); day < new Date(`${to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

// Every spec file's quarantined test titles.
const tagged = new Map<string, Set<string>>();
for (const file of readdirSync(join(root, 'specs')).filter((name) => name.endsWith('.spec.ts'))) {
  const source = readFileSync(join(root, 'specs', file), 'utf8');
  for (const match of source.matchAll(/test\(\s*(['"`])((?:(?!\1).)+)\1\s*,\s*\{[^}]*@quarantine[^}]*\}/g)) {
    if (!tagged.has(file)) tagged.set(file, new Set());
    tagged.get(file)?.add(match[2] ?? '');
  }
}

// Every test sits in a tier (T-113 part 3): @smoke (the PR gate's critical journeys) or @regression.
for (const file of readdirSync(join(root, 'specs')).filter((name) => name.endsWith('.spec.ts'))) {
  const source = readFileSync(join(root, 'specs', file), 'utf8');
  for (const match of source.matchAll(/^\s*test\(\s*(['"`])((?:(?!\1).)+)\1\s*,\s*(\{[^}]*\}\s*,\s*)?async/gm)) {
    if (!/@smoke|@regression/.test(match[3] ?? '')) problems.push(`${file} › ${match[2]}: tag it { tag: '@smoke' } or { tag: '@regression' } (README, "Tiers").`);
  }
}

if (register.tests.length > 8) problems.push(`${register.tests.length} tests quarantined; the cap is 8. Fix or delete some first.`);
for (const entry of register.tests) {
  const label = `${entry.spec} › ${entry.title}`;
  if (!entry.owner?.trim()) problems.push(`${label}: no owner.`);
  if (!entry.reason?.trim()) problems.push(`${label}: no reason.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.quarantinedOn ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(entry.fixBy ?? '')) problems.push(`${label}: dates must be YYYY-MM-DD.`);
  else {
    if (workingDaysBetween(entry.quarantinedOn, entry.fixBy) > 10) problems.push(`${label}: fix-by ${entry.fixBy} is more than 10 working days after ${entry.quarantinedOn}.`);
    if (entry.fixBy < today) problems.push(`${label}: fix-by ${entry.fixBy} has passed. Fix it or delete it.`);
  }
  if (!tagged.get(entry.spec)?.has(entry.title)) problems.push(`${label}: listed but not tagged @quarantine in specs/${entry.spec}.`);
}
for (const [spec, titles] of tagged) {
  for (const title of titles) if (!register.tests.some((entry) => entry.spec === spec && entry.title === title)) problems.push(`${spec} › ${title}: tagged @quarantine but not in quarantine.json (owner and date).`);
}

if (problems.length > 0) {
  process.stderr.write(`Quarantine register problems:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`${register.tests.length}\n`);
