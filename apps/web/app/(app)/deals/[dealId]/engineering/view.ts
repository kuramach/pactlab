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

/** One person on the map and network: compact, every contributor in one response (T-055). */
export interface PointView {
  contributorKey: string;
  label: string;
  name: string | null;
  commits: number;
  coordination: number;
  issuesResolved: number;
  tags: ContributorTag[];
  status: 'CURRENT' | 'DEPARTED' | 'UNKNOWN';
  areasActive: string[];
  areasOwned: string[];
  areasSolelyOwned: string[];
}

export interface EngineeringView {
  version: string;
  window: { from: string; to: string };
  months: { month: string; commits: number; codeContributors: number; deliveryContributors: number; issuesResolved: number; pointsResolved: number; reopenRate: string | null }[];
  areas: { area: string; commits: number; contributors: number; busFactor: number }[];
  singleMaintainerAreas: string[];
  contributors: number;
  busFactor: number;
  unmatchedOrDepartedShare: string | null;
  suppressed: boolean;
  points: PointView[];
  keepList: { contributorKey: string; label: string; name: string | null; reason: string }[];
  keepCount: number;
  completeness: { complete: boolean; notes: string[] };
  people: PeopleAccessView;
  canManageNames: boolean;
  sources: { id: string; provider: string; displayName: string; mode: 'FIXTURE' | 'LIVE' }[];
  keyPersonFindings: { id: string; title: string; status: string; direction: number | null }[];
}

/** One page of full profiles from `engineering/people`. */
export interface PeoplePage {
  items: ProfileView[];
  total: number;
  nextCursor: number | null;
  suppressed: boolean;
}

/** Above this many people the map drops labels and shrinks points; at or below it, labels as before. */
export const MAP_LABEL_LIMIT = 150;
/** Up to this many people the network shows everyone; above it, areas and their key people only. */
export const NETWORK_FULL_LIMIT = 60;
/** The areas chart shows this many busiest areas, then "Other". */
export const AREA_CHART_LIMIT = 25;
export const PEOPLE_PAGE_SIZE = 50;

export const mapMode = (people: number): 'LABELLED' | 'LARGE' => (people > MAP_LABEL_LIMIT ? 'LARGE' : 'LABELLED');
export const networkMode = (people: number): 'FULL' | 'AREAS' => (people > NETWORK_FULL_LIMIT ? 'AREAS' : 'FULL');

/** The busiest areas (already sorted by commits), with the rest folded into one "Other" bar. */
export function foldAreas(areas: EngineeringView['areas'], limit = AREA_CHART_LIMIT) {
  if (areas.length <= limit) return { shown: areas, other: null };
  const rest = areas.slice(limit);
  return { shown: areas.slice(0, limit), other: { count: rest.length, commits: rest.reduce((total, area) => total + area.commits, 0) } };
}

export interface PeopleFilters {
  q: string;
  tag: ContributorTag | null;
  area: string | null;
  keep: boolean;
  page: number;
}

const TAGS: readonly ContributorTag[] = ['CRITICAL_OWNER', 'COORDINATOR', 'BUILDER', 'CROSS_AREA', 'RECENTLY_QUIET'];

/** The details table's filters from the page URL; anything malformed reads as unset. */
export function parsePeopleFilters(query: Record<string, string | string[] | undefined>): PeopleFilters {
  const one = (key: string) => (typeof query[key] === 'string' ? (query[key] as string) : '');
  const page = Number.parseInt(one('page'), 10);
  const tag = one('tag');
  return {
    q: one('q').trim().slice(0, 100),
    tag: (TAGS as readonly string[]).includes(tag) ? (tag as ContributorTag) : null,
    area: one('area').trim().slice(0, 200) || null,
    keep: one('keep') === 'true',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The `engineering/people` query for a page of the details table. */
export function peopleApiQuery(filters: PeopleFilters): string {
  const params = new URLSearchParams({ limit: String(PEOPLE_PAGE_SIZE), cursor: String((filters.page - 1) * PEOPLE_PAGE_SIZE) });
  if (filters.q) params.set('q', filters.q);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.area) params.set('area', filters.area);
  if (filters.keep) params.set('keep', 'true');
  return params.toString();
}

/** The page URL for the same filters on another page (the table lives at #details). */
export function peoplePageHref(dealId: string, filters: PeopleFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.area) params.set('area', filters.area);
  if (filters.keep) params.set('keep', 'true');
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/deals/${dealId}/engineering${query ? `?${query}` : ''}#details`;
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
  readonly tags: readonly ContributorTag[];
  readonly areas: readonly string[];
}

/**
 * Code vs delivery: one point per person, placed by two activity signals.
 * Points keep the API's order (first activity) — nothing here ranks people.
 */
export function peopleMapPoints(points: readonly PointView[], dealId: string): PeopleMapPoint[] {
  return points.map((point) => {
    const main = TAG_PRIORITY.find((tag) => point.tags.includes(tag));
    return {
      key: point.contributorKey,
      name: displayName(point),
      code: point.commits,
      coordination: point.coordination,
      resolved: point.issuesResolved,
      group: main ? TAG_LABELS[main].label : NO_TAG,
      href: `/deals/${dealId}/engineering/contributors/${point.contributorKey}`,
      tags: point.tags,
      areas: point.areasActive,
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
  readonly mode: 'FULL' | 'AREAS';
  readonly people: readonly { id: string; name: string; href: string; critical: boolean; departed: boolean }[];
  /** `others`: people active in the area but not drawn (AREAS mode, until the area is expanded). */
  readonly areas: readonly { id: string; area: string; commits: number; busFactor: number; others: number }[];
  readonly links: readonly { source: string; target: string; strength: OwnershipStrength }[];
}

/**
 * People ↔ code areas. A link's strength follows the engineering calculation:
 * SOLE (≥ 80% of the area's commits), OWNER (≥ 50%), otherwise ACTIVE.
 * Up to NETWORK_FULL_LIMIT people everyone is drawn; above it only key people
 * (owners and sole owners) and the people of any expanded area, with the rest
 * counted on each area.
 */
export function ownershipGraph(points: readonly PointView[], areas: EngineeringView['areas'], dealId: string, expanded: ReadonlySet<string> = new Set()): OwnershipGraph {
  const mode = networkMode(points.length);
  const areaId = (area: string) => `area:${area}`;
  const known = new Set(areas.map((entry) => entry.area));
  const drawn = mode === 'FULL' ? points : points.filter((point) => point.areasOwned.length > 0 || point.areasActive.some((area) => expanded.has(area)));
  const links = drawn.flatMap((point) =>
    point.areasActive
      .filter((area) => known.has(area) && (mode === 'FULL' || expanded.has(area) || point.areasOwned.includes(area)))
      .map((area) => ({
        source: `person:${point.contributorKey}`,
        target: areaId(area),
        strength: (point.areasSolelyOwned.includes(area) ? 'SOLE' : point.areasOwned.includes(area) ? 'OWNER' : 'ACTIVE') as OwnershipStrength,
      })),
  );
  const linked = new Map<string, number>();
  for (const link of links) linked.set(link.target, (linked.get(link.target) ?? 0) + 1);
  return {
    mode,
    people: drawn.map((point) => ({
      id: `person:${point.contributorKey}`,
      name: displayName(point),
      href: `/deals/${dealId}/engineering/contributors/${point.contributorKey}`,
      critical: point.areasSolelyOwned.length > 0,
      departed: point.status === 'DEPARTED',
    })),
    areas: areas.map((entry) => ({
      id: areaId(entry.area),
      area: entry.area,
      commits: entry.commits,
      busFactor: entry.busFactor,
      others: mode === 'FULL' ? 0 : Math.max(0, entry.contributors - (linked.get(areaId(entry.area)) ?? 0)),
    })),
    links,
  };
}
