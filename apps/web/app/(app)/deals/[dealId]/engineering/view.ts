export type ContributorTag = 'CRITICAL_OWNER' | 'COORDINATOR' | 'BUILDER' | 'CROSS_AREA' | 'RECENTLY_QUIET';

export interface ProfileView {
  contributorKey: string;
  label: string;
  name: string | null;
  status: 'CURRENT' | 'DEPARTED' | 'UNKNOWN';
  commits: number;
  linesChanged: number;
  areasActive: string[];
  areasOwned: string[];
  areasSolelyOwned: string[];
  issuesResolved: number;
  pointsResolved: number;
  issuesCreated: number;
  comments: number;
  reopenRatio: string | null;
  firstActiveMonth: string;
  lastActiveMonth: string;
  trend: 'UP' | 'DOWN' | 'STEADY';
  tags: ContributorTag[];
  summary: string;
}

export interface PeopleAccessView {
  enabled: boolean;
  basis: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface EngineeringView {
  window: { from: string; to: string };
  months: { month: string; commits: number; codeContributors: number; deliveryContributors: number; issuesResolved: number; pointsResolved: number; reopenRate: string | null }[];
  areas: { area: string; commits: number; contributors: number; busFactor: number }[];
  contributors: number;
  busFactor: number;
  unmatchedOrDepartedShare: string | null;
  suppressed: boolean;
  profiles: ProfileView[];
  keepList: { contributorKey: string; label: string; name: string | null; reason: string }[];
  people: PeopleAccessView;
  canManageNames: boolean;
  sources: { id: string; provider: string; displayName: string; mode: 'FIXTURE' | 'LIVE' }[];
  keyPersonFindings: { id: string; title: string; status: string; direction: number | null }[];
}

/** Plain-language tags: descriptions of activity, never a verdict on a person. */
export const TAG_LABELS: Readonly<Record<ContributorTag, { label: string; help: string; variant: 'danger' | 'reviewed' | 'calculation' | 'evidence' | 'neutral' }>> = {
  CRITICAL_OWNER: { label: 'Critical owner', help: 'The only regular maintainer of at least one area of the code.', variant: 'danger' },
  COORDINATOR: { label: 'Coordinator', help: 'Few commits, but creates and discusses much of the delivery work in Jira — often a lead, architect or product role.', variant: 'reviewed' },
  BUILDER: { label: 'Builder', help: 'Among the most active committers in the last 12 months.', variant: 'calculation' },
  CROSS_AREA: { label: 'Cross-area', help: 'Works across three or more areas of the code.', variant: 'evidence' },
  RECENTLY_QUIET: { label: 'Recently quiet', help: 'No recorded activity in the last three months — could be leave, a role change or work outside these tools.', variant: 'neutral' },
};

/** "Contributor 07" or "Grace Okafor (synthetic) · Contributor 07" when names are shown. */
export function displayName(profile: { label: string; name: string | null }): string {
  return profile.name ? `${profile.name} · ${profile.label}` : profile.label;
}

/** '0.0909' → '9.1%'. Display only. */
export function percentLabel(ratio: string | null): string {
  if (ratio === null) return '—';
  const [whole = '0', fraction = ''] = ratio.split('.');
  const basisPoints = Number(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
  return `${(basisPoints / 100).toFixed(1).replace(/\.0$/, '')}%`;
}

/** The two pictures of the People section. */
export type PeopleView = 'map' | 'network';
export function parsePeopleView(value: unknown): PeopleView {
  return value === 'network' ? 'network' : 'map';
}

/** Which tag colours a person's dot: the most consequential one they carry. */
const TAG_PRIORITY: readonly ContributorTag[] = ['CRITICAL_OWNER', 'COORDINATOR', 'BUILDER', 'CROSS_AREA', 'RECENTLY_QUIET'];
export const NO_TAG = 'No tag';

export interface PeopleMapPoint {
  readonly key: string;
  readonly name: string;
  /** Commits, last 12 months. */
  readonly code: number;
  /** Jira issues created + comments: the coordination signal. */
  readonly coordination: number;
  /** Jira issues resolved: bubble size. */
  readonly resolved: number;
  readonly group: string;
  readonly href: string;
}

/**
 * Code vs delivery: one point per person, placed by two activity signals.
 * Points keep the API's order (first activity) — nothing here ranks people.
 */
export function peopleMapPoints(profiles: readonly ProfileView[], dealId: string): PeopleMapPoint[] {
  return profiles.map((profile) => {
    const main = TAG_PRIORITY.find((tag) => profile.tags.includes(tag));
    return {
      key: profile.contributorKey,
      name: displayName(profile),
      code: profile.commits,
      coordination: profile.issuesCreated + profile.comments,
      resolved: profile.issuesResolved,
      group: main ? TAG_LABELS[main].label : NO_TAG,
      href: `/deals/${dealId}/engineering/contributors/${profile.contributorKey}`,
    };
  });
}

/** Median of a list of counts, as the map's reference lines. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export type OwnershipStrength = 'SOLE' | 'OWNER' | 'ACTIVE';
export interface OwnershipGraph {
  readonly people: readonly { id: string; name: string; href: string; critical: boolean; departed: boolean }[];
  readonly areas: readonly { id: string; area: string; commits: number; busFactor: number }[];
  readonly links: readonly { source: string; target: string; strength: OwnershipStrength }[];
}

/**
 * People ↔ code areas. A link's strength follows the engineering calculation:
 * SOLE (≥ 80% of the area's commits), OWNER (≥ 50%), otherwise ACTIVE.
 */
export function ownershipGraph(profiles: readonly ProfileView[], areas: EngineeringView['areas'], dealId: string): OwnershipGraph {
  const areaId = (area: string) => `area:${area}`;
  const known = new Set(areas.map((entry) => entry.area));
  const links = profiles.flatMap((profile) =>
    profile.areasActive
      .filter((area) => known.has(area))
      .map((area) => ({
        source: `person:${profile.contributorKey}`,
        target: areaId(area),
        strength: (profile.areasSolelyOwned.includes(area) ? 'SOLE' : profile.areasOwned.includes(area) ? 'OWNER' : 'ACTIVE') as OwnershipStrength,
      })),
  );
  return {
    people: profiles.map((profile) => ({
      id: `person:${profile.contributorKey}`,
      name: displayName(profile),
      href: `/deals/${dealId}/engineering/contributors/${profile.contributorKey}`,
      critical: profile.areasSolelyOwned.length > 0,
      departed: profile.status === 'DEPARTED',
    })),
    areas: areas.map((entry) => ({ id: areaId(entry.area), area: entry.area, commits: entry.commits, busFactor: entry.busFactor })),
    links,
  };
}
