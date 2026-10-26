import { D, ratio } from '../metrics/decimal';
import { addMonths } from '../metrics/months';
import type { AreaHealth, ContributorProfile, ContributorTag, EngineeringInput, KeepCandidate, MonthHealth } from './engineering';

/**
 * The engineering-1 calculation, kept verbatim as the reference T-055's
 * linear rewrite is tested against (same outputs on the same inputs). Test
 * use only; not exported from the package.
 */
const ENGINEERING_VERSION = 'engineering-1';

/** Below this many contributors, no individual profile is shown (aggregates only). */
const MIN_PROFILE_COHORT = 5;
/** An area is owned at ≥ 50% of its commits and solely owned at ≥ 80% (with enough commits to matter). */
const OWNED_SHARE = new D('0.5');
const SOLE_SHARE = new D('0.8');
const OWNED_MIN_COMMITS = 5;
const SOLE_MIN_COMMITS = 10;
const WINDOW_MONTHS = 12;

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function busFactor(counts: readonly number[]): number {
  const total = sum(counts);
  if (total === 0) return 0;
  let covered = 0;
  let people = 0;
  for (const count of [...counts].sort((a, b) => b - a)) {
    covered += count;
    people += 1;
    if (covered * 2 > total) break;
  }
  return people;
}

/** Nearest-rank percentile of integers; deterministic and float-free. */
function percentile(values: readonly number[], p: 50 | 75): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function summarize(profile: Omit<ContributorProfile, 'summary' | 'label'>): string {
  const parts: string[] = [];
  if (profile.tags.includes('CRITICAL_OWNER')) parts.push(`the only regular maintainer of ${profile.areasSolelyOwned.join(', ')}`);
  if (profile.tags.includes('COORDINATOR'))
    parts.push(`few commits but creates and discusses much of the delivery work (${plural(profile.issuesCreated, 'issue')} created, ${plural(profile.comments, 'comment')}) — likely a lead or coordinator`);
  if (profile.tags.includes('BUILDER')) parts.push(`one of the most active committers (${plural(profile.commits, 'commit')})`);
  if (profile.tags.includes('CROSS_AREA')) parts.push(`works across ${plural(profile.areasActive.length, 'area')}`);
  if (parts.length === 0) {
    parts.push(
      profile.commits > 0
        ? `${plural(profile.commits, 'commit')}${profile.issuesResolved ? ` and ${plural(profile.issuesResolved, 'resolved issue')}` : ''} in the last 12 months`
        : `${plural(profile.issuesResolved, 'resolved issue')} and ${plural(profile.issuesCreated, 'created issue')}; no commits`,
    );
  }
  if (profile.tags.includes('RECENTLY_QUIET')) parts.push('no recorded activity in the last 3 months');
  if (profile.status === 'DEPARTED') parts.push('recorded as departed');
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * Team health and contributor profiles from code and delivery activity.
 * Deterministic, integers and decimal-string ratios only. Profiles describe
 * activity — they carry no score and no ranking — and are withheld entirely
 * for teams under MIN_PROFILE_COHORT. Keys are pseudonymous; names are added
 * (or not) by the caller under the names gate.
 */
export function referenceReport(input: EngineeringInput) {
  const to = input.asOfMonth;
  const from = addMonths(to, -(WINDOW_MONTHS - 1));
  const inWindow = (month: string) => month >= from && month <= to;
  const code = input.code.filter((row) => inWindow(row.month));
  const delivery = input.delivery.filter((row) => inWindow(row.month));
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);

  const monthHealth: MonthHealth[] = months.map((month) => {
    const codeRows = code.filter((row) => row.month === month);
    const deliveryRows = delivery.filter((row) => row.month === month);
    const resolved = sum(deliveryRows.map((row) => row.issuesResolved));
    return {
      month,
      commits: sum(codeRows.map((row) => row.commits)),
      codeContributors: new Set(codeRows.filter((row) => row.commits > 0).map((row) => row.contributorKey)).size,
      deliveryContributors: new Set(deliveryRows.filter((row) => row.issuesResolved + row.issuesCreated > 0).map((row) => row.contributorKey)).size,
      issuesResolved: resolved,
      pointsResolved: sum(deliveryRows.map((row) => row.pointsResolved)),
      reopenRate: resolved === 0 ? null : ratio(new D(sum(deliveryRows.map((row) => row.resolvedReopened))), new D(resolved)),
    };
  });

  // Area ownership: commits per area per contributor.
  const areaCommits = new Map<string, Map<string, number>>();
  for (const row of code) {
    for (const [area, count] of Object.entries(row.areas)) {
      const owners = areaCommits.get(area) ?? new Map<string, number>();
      owners.set(row.contributorKey, (owners.get(row.contributorKey) ?? 0) + count);
      areaCommits.set(area, owners);
    }
  }
  const areas: AreaHealth[] = [...areaCommits.entries()]
    .map(([area, owners]) => ({ area, commits: sum([...owners.values()]), contributors: owners.size, busFactor: busFactor([...owners.values()]) }))
    .sort((a, b) => b.commits - a.commits || a.area.localeCompare(b.area));

  const keys = [...new Set([...code.map((row) => row.contributorKey), ...delivery.map((row) => row.contributorKey)])];
  const commitsBy = new Map(keys.map((key) => [key, sum(code.filter((row) => row.contributorKey === key).map((row) => row.commits))]));
  const totalCommits = sum([...commitsBy.values()]);
  const unmatched = sum(keys.filter((key) => (input.statuses.get(key) ?? 'UNKNOWN') !== 'CURRENT').map((key) => commitsBy.get(key) ?? 0));

  const base = {
    version: ENGINEERING_VERSION,
    window: { from, to },
    months: monthHealth,
    areas,
    contributors: keys.length,
    busFactor: busFactor([...commitsBy.values()].filter((count) => count > 0)),
    unmatchedOrDepartedShare: totalCommits === 0 ? null : ratio(new D(unmatched), new D(totalCommits)),
  } as const;
  if (keys.length < MIN_PROFILE_COHORT) return { ...base, suppressed: true, profiles: [], keepList: [] };

  const recent = new Set(months.slice(-3));
  const previous = new Set(months.slice(-6, -3));
  const raw = keys.map((key) => {
    const mine = code.filter((row) => row.contributorKey === key);
    const work = delivery.filter((row) => row.contributorKey === key);
    const activeMonths = [...mine.filter((row) => row.commits > 0), ...work.filter((row) => row.issuesResolved + row.issuesCreated + row.comments > 0)].map((row) => row.month).sort();
    const areaTotals = new Map<string, number>();
    for (const row of mine) for (const [area, count] of Object.entries(row.areas)) areaTotals.set(area, (areaTotals.get(area) ?? 0) + count);
    const share = (area: string) => {
      const owners = areaCommits.get(area);
      const total = owners ? sum([...owners.values()]) : 0;
      return { total, share: total === 0 ? new D(0) : new D(owners?.get(key) ?? 0).dividedBy(total) };
    };
    const areasActive = [...areaTotals.keys()].sort();
    const areasOwned = areasActive.filter((area) => share(area).total >= OWNED_MIN_COMMITS && share(area).share.greaterThanOrEqualTo(OWNED_SHARE));
    const areasSolelyOwned = areasActive.filter((area) => share(area).total >= SOLE_MIN_COMMITS && share(area).share.greaterThanOrEqualTo(SOLE_SHARE));
    const resolved = sum(work.map((row) => row.issuesResolved));
    const activityIn = (set: Set<string>) =>
      sum(mine.filter((row) => set.has(row.month)).map((row) => row.commits)) + sum(work.filter((row) => set.has(row.month)).map((row) => row.issuesResolved));
    const now = activityIn(recent);
    const before = activityIn(previous);
    return {
      contributorKey: key,
      status: input.statuses.get(key) ?? ('UNKNOWN' as const),
      commits: commitsBy.get(key) ?? 0,
      linesChanged: sum(mine.map((row) => row.additions + row.deletions)),
      areasActive,
      areasOwned,
      areasSolelyOwned,
      issuesResolved: resolved,
      pointsResolved: sum(work.map((row) => row.pointsResolved)),
      issuesCreated: sum(work.map((row) => row.issuesCreated)),
      comments: sum(work.map((row) => row.comments)),
      reopenRatio: resolved === 0 ? null : ratio(new D(sum(work.map((row) => row.resolvedReopened))), new D(resolved)),
      firstActiveMonth: activeMonths[0] ?? to,
      lastActiveMonth: activeMonths[activeMonths.length - 1] ?? from,
      trend: now * 3 > before * 4 ? ('UP' as const) : now * 4 < before * 3 ? ('DOWN' as const) : ('STEADY' as const),
    };
  });

  const commitValues = raw.map((entry) => entry.commits);
  const coordination = raw.map((entry) => entry.issuesCreated + entry.comments);
  const medianCommits = percentile(commitValues, 50);
  const topCommits = percentile(commitValues, 75);
  const topCoordination = percentile(coordination, 75);
  const quietSince = addMonths(to, -2);

  const ordered = [...raw].sort((a, b) => a.firstActiveMonth.localeCompare(b.firstActiveMonth) || a.contributorKey.localeCompare(b.contributorKey));
  const profiles: ContributorProfile[] = ordered.map((entry, index) => {
    const tags: ContributorTag[] = [];
    if (entry.areasSolelyOwned.length > 0) tags.push('CRITICAL_OWNER');
    const coordinates = entry.issuesCreated + entry.comments;
    if (coordinates > 0 && coordinates >= topCoordination && entry.commits < medianCommits) tags.push('COORDINATOR');
    if (entry.commits > 0 && entry.commits >= topCommits) tags.push('BUILDER');
    if (entry.areasActive.length >= 3) tags.push('CROSS_AREA');
    if (entry.lastActiveMonth < quietSince) tags.push('RECENTLY_QUIET');
    const profile = { ...entry, tags };
    return { ...profile, label: `Contributor ${String(index + 1).padStart(2, '0')}`, summary: summarize(profile) };
  });

  const keepList: KeepCandidate[] = profiles
    .filter((profile) => profile.status !== 'DEPARTED' && (profile.tags.includes('CRITICAL_OWNER') || profile.tags.includes('COORDINATOR')))
    .map((profile) => ({
      contributorKey: profile.contributorKey,
      label: profile.label,
      reason: profile.tags.includes('CRITICAL_OWNER')
        ? `Only regular maintainer of ${profile.areasSolelyOwned.join(', ')} — a loss here stalls that code.`
        : `Coordinates delivery: ${plural(profile.issuesCreated, 'issue')} created and ${plural(profile.comments, 'comment')} in 12 months, with few commits.`,
    }));

  return { ...base, suppressed: false, profiles, keepList };
}
