import { D, ratio } from '../metrics/decimal';
import { addMonths } from '../metrics/months';

/** Bumped whenever a rule, threshold or output shape changes. */
export const ENGINEERING_VERSION = 'engineering-2';

/** Below this many contributors, no individual profile is shown (aggregates only). */
export const MIN_PROFILE_COHORT = 5;
/** An area is owned at ≥ 50% of its commits and solely owned at ≥ 80% (with enough commits to matter). */
const OWNED_SHARE = new D('0.5');
const SOLE_SHARE = new D('0.8');
const OWNED_MIN_COMMITS = 5;
const SOLE_MIN_COMMITS = 10;
const WINDOW_MONTHS = 12;

export interface CodeActivity {
  readonly contributorKey: string;
  readonly month: string;
  readonly commits: number;
  readonly additions: number;
  readonly deletions: number;
  readonly areas: Readonly<Record<string, number>>;
}

export interface DeliveryActivity {
  readonly contributorKey: string;
  readonly month: string;
  readonly issuesResolved: number;
  readonly pointsResolved: number;
  readonly issuesCreated: number;
  readonly comments: number;
  readonly resolvedReopened: number;
  readonly sprints: number;
}

export type ContributorStatus = 'CURRENT' | 'DEPARTED' | 'UNKNOWN';

export interface EngineeringInput {
  readonly code: readonly CodeActivity[];
  readonly delivery: readonly DeliveryActivity[];
  /** Identity-map status per contributor key (no names). */
  readonly statuses: ReadonlyMap<string, ContributorStatus>;
  /** `YYYY-MM`: the last month of the 12-month window. */
  readonly asOfMonth: string;
}

export interface MonthHealth {
  readonly month: string;
  readonly commits: number;
  readonly codeContributors: number;
  readonly deliveryContributors: number;
  readonly issuesResolved: number;
  readonly pointsResolved: number;
  /** Resolved issues later reopened ÷ issues resolved, four places; null with nothing resolved. */
  readonly reopenRate: string | null;
}

export interface AreaHealth {
  readonly area: string;
  readonly commits: number;
  readonly contributors: number;
  /** Fewest contributors who together made more than half of the area's commits. */
  readonly busFactor: number;
}

export type ContributorTag = 'CRITICAL_OWNER' | 'COORDINATOR' | 'BUILDER' | 'CROSS_AREA' | 'RECENTLY_QUIET';

export interface ContributorProfile {
  readonly contributorKey: string;
  /** "Contributor 07": numbered by first activity, stable for the same data. */
  readonly label: string;
  readonly status: ContributorStatus;
  readonly commits: number;
  readonly linesChanged: number;
  readonly areasActive: readonly string[];
  readonly areasOwned: readonly string[];
  readonly areasSolelyOwned: readonly string[];
  readonly issuesResolved: number;
  readonly pointsResolved: number;
  readonly issuesCreated: number;
  readonly comments: number;
  readonly reopenRatio: string | null;
  readonly firstActiveMonth: string;
  readonly lastActiveMonth: string;
  /** Activity (commits + resolved issues) in the last 3 months against the 3 before. */
  readonly trend: 'UP' | 'DOWN' | 'STEADY';
  readonly tags: readonly ContributorTag[];
  readonly summary: string;
}

/** One person on the code-vs-delivery map: compact, so every contributor fits in one response (T-055). */
export interface ContributorPoint {
  readonly contributorKey: string;
  readonly label: string;
  readonly commits: number;
  /** Issues created + comments: the coordination signal. */
  readonly coordination: number;
  readonly issuesResolved: number;
  readonly tags: readonly ContributorTag[];
  readonly status: ContributorStatus;
  readonly areasActive: readonly string[];
  readonly areasOwned: readonly string[];
  readonly areasSolelyOwned: readonly string[];
}

export interface KeepCandidate {
  readonly contributorKey: string;
  readonly label: string;
  readonly reason: string;
}

export interface EngineeringReport {
  readonly version: typeof ENGINEERING_VERSION;
  readonly window: { readonly from: string; readonly to: string };
  readonly months: readonly MonthHealth[];
  readonly areas: readonly AreaHealth[];
  readonly contributors: number;
  readonly busFactor: number;
  /** Commits from identities missing from the identity map or departed, ÷ all commits. */
  readonly unmatchedOrDepartedShare: string | null;
  /** True when the team is too small for individual profiles. */
  readonly suppressed: boolean;
  readonly profiles: readonly ContributorProfile[];
  readonly keepList: readonly KeepCandidate[];
  /** Every profile as a map point (empty when suppressed). */
  readonly points: readonly ContributorPoint[];
}

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
export function engineeringReport(input: EngineeringInput): EngineeringReport {
  const to = input.asOfMonth;
  const from = addMonths(to, -(WINDOW_MONTHS - 1));
  const inWindow = (month: string) => month >= from && month <= to;
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);

  // One pass over each source: rows by contributor and by month (T-055, linear in the rows).
  const keys: string[] = [];
  const seen = new Set<string>();
  const remember = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  const codeBy = new Map<string, CodeActivity[]>();
  const workBy = new Map<string, DeliveryActivity[]>();
  const codeByMonth = new Map<string, CodeActivity[]>();
  const workByMonth = new Map<string, DeliveryActivity[]>();
  const push = <T>(map: Map<string, T[]>, key: string, row: T) => {
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  };
  const code: CodeActivity[] = [];
  for (const row of input.code) {
    if (!inWindow(row.month)) continue;
    code.push(row);
    push(codeBy, row.contributorKey, row);
    push(codeByMonth, row.month, row);
  }
  for (const row of code) remember(row.contributorKey);
  for (const row of input.delivery) {
    if (!inWindow(row.month)) continue;
    push(workBy, row.contributorKey, row);
    push(workByMonth, row.month, row);
    remember(row.contributorKey);
  }

  const monthHealth: MonthHealth[] = months.map((month) => {
    const codeRows = codeByMonth.get(month) ?? [];
    const deliveryRows = workByMonth.get(month) ?? [];
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

  // Area ownership: commits per area per contributor, and each area's total, once.
  const areaCommits = new Map<string, Map<string, number>>();
  for (const row of code) {
    for (const [area, count] of Object.entries(row.areas)) {
      const owners = areaCommits.get(area) ?? new Map<string, number>();
      owners.set(row.contributorKey, (owners.get(row.contributorKey) ?? 0) + count);
      areaCommits.set(area, owners);
    }
  }
  const areaTotal = new Map([...areaCommits.entries()].map(([area, owners]) => [area, sum([...owners.values()])]));
  const areas: AreaHealth[] = [...areaCommits.entries()]
    .map(([area, owners]) => ({ area, commits: areaTotal.get(area) ?? 0, contributors: owners.size, busFactor: busFactor([...owners.values()]) }))
    .sort((a, b) => b.commits - a.commits || a.area.localeCompare(b.area));

  const commitsBy = new Map(keys.map((key) => [key, sum((codeBy.get(key) ?? []).map((row) => row.commits))]));
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
  if (keys.length < MIN_PROFILE_COHORT) return { ...base, suppressed: true, profiles: [], keepList: [], points: [] };

  const recent = new Set(months.slice(-3));
  const previous = new Set(months.slice(-6, -3));
  const raw = keys.map((key) => {
    const mine = codeBy.get(key) ?? [];
    const work = workBy.get(key) ?? [];
    const activeMonths = [...mine.filter((row) => row.commits > 0), ...work.filter((row) => row.issuesResolved + row.issuesCreated + row.comments > 0)].map((row) => row.month).sort();
    const areaTotals = new Map<string, number>();
    for (const row of mine) for (const [area, count] of Object.entries(row.areas)) areaTotals.set(area, (areaTotals.get(area) ?? 0) + count);
    const share = (area: string) => {
      const total = areaTotal.get(area) ?? 0;
      return { total, share: total === 0 ? new D(0) : new D(areaCommits.get(area)?.get(key) ?? 0).dividedBy(total) };
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

  const points: ContributorPoint[] = profiles.map((profile) => ({
    contributorKey: profile.contributorKey,
    label: profile.label,
    commits: profile.commits,
    coordination: profile.issuesCreated + profile.comments,
    issuesResolved: profile.issuesResolved,
    tags: profile.tags,
    status: profile.status,
    areasActive: profile.areasActive,
    areasOwned: profile.areasOwned,
    areasSolelyOwned: profile.areasSolelyOwned,
  }));

  return { ...base, suppressed: false, profiles, keepList, points };
}
