import { describe, expect, it } from 'vitest';
import {
  foldAreas,
  mapMode,
  median,
  networkMode,
  NO_TAG,
  ownershipGraph,
  parsePeopleFilters,
  parsePeopleView,
  peopleApiQuery,
  peopleMapPoints,
  peoplePageHref,
  type PointView,
  type ProfileView,
} from './view';

const profile = (key: string, overrides: Partial<ProfileView> = {}): ProfileView => ({
  contributorKey: key,
  label: `Contributor ${key}`,
  name: null,
  status: 'CURRENT',
  commits: 0,
  linesChanged: 0,
  areasActive: [],
  areasOwned: [],
  areasSolelyOwned: [],
  issuesResolved: 0,
  pointsResolved: 0,
  issuesCreated: 0,
  comments: 0,
  reopenRatio: null,
  firstActiveMonth: '2025-10',
  lastActiveMonth: '2026-09',
  trend: 'STEADY',
  tags: [],
  summary: '',
  ...overrides,
});

const grace = profile('01', { name: 'Grace (synthetic)', commits: 4, issuesCreated: 30, comments: 50, issuesResolved: 12, tags: ['COORDINATOR', 'CROSS_AREA'], areasActive: ['web', 'api'] });
const sam = profile('02', { commits: 140, issuesResolved: 20, tags: ['BUILDER', 'CRITICAL_OWNER'], areasActive: ['billing', 'api'], areasOwned: ['billing', 'api'], areasSolelyOwned: ['billing'] });
const lee = profile('03', { commits: 10, status: 'DEPARTED', areasActive: ['infra', 'retired-area'] });
/** A profile as the overview's compact point. */
const point = (entry: ProfileView): PointView => ({
  contributorKey: entry.contributorKey,
  label: entry.label,
  name: entry.name,
  commits: entry.commits,
  coordination: entry.issuesCreated + entry.comments,
  issuesResolved: entry.issuesResolved,
  tags: entry.tags,
  status: entry.status,
  areasActive: entry.areasActive,
  areasOwned: entry.areasOwned,
  areasSolelyOwned: entry.areasSolelyOwned,
});
const areas = [
  { area: 'billing', commits: 120, contributors: 1, busFactor: 1 },
  { area: 'api', commits: 80, contributors: 2, busFactor: 2 },
  { area: 'web', commits: 30, contributors: 1, busFactor: 1 },
  { area: 'infra', commits: 12, contributors: 1, busFactor: 1 },
];

describe('people views', () => {
  it('defaults to the code-vs-delivery map; anything unknown falls back to it', () => {
    expect(parsePeopleView(undefined)).toBe('map');
    expect(parsePeopleView('network')).toBe('network');
    expect(parsePeopleView(['network'])).toBe('map');
    expect(parsePeopleView('<script>')).toBe('map');
  });

  it('places each person by commits and Jira coordination, coloured by their most consequential tag', () => {
    const points = peopleMapPoints([grace, sam, lee].map(point), 'deal-1');
    expect(points.map((point) => point.key)).toEqual(['01', '02', '03']); // API order, never re-ranked
    expect(points[0]).toMatchObject({ name: 'Grace (synthetic) · Contributor 01', code: 4, coordination: 80, resolved: 12, group: 'Coordinator', href: '/deals/deal-1/engineering/contributors/01' });
    expect(points[1]).toMatchObject({ code: 140, coordination: 0, group: 'Critical owner' });
    expect(points[2]).toMatchObject({ name: 'Contributor 03', group: NO_TAG });
    for (const point of points) expect(Object.keys(point)).not.toEqual(expect.arrayContaining(['score', 'rank']));
  });

  it('draws the team medians', () => {
    expect(median([4, 140, 10])).toBe(10);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('links people to the areas they work in, with sole ownership and single-maintainer areas marked', () => {
    const graph = ownershipGraph([grace, sam, lee].map(point), areas, 'deal-1');
    expect(graph.people.map((person) => [person.name, person.critical, person.departed])).toEqual([
      ['Grace (synthetic) · Contributor 01', false, false],
      ['Contributor 02', true, false],
      ['Contributor 03', false, true],
    ]);
    expect(graph.links).toEqual(
      expect.arrayContaining([
        { source: 'person:02', target: 'area:billing', strength: 'SOLE' },
        { source: 'person:02', target: 'area:api', strength: 'OWNER' },
        { source: 'person:01', target: 'area:web', strength: 'ACTIVE' },
      ]),
    );
    // A link never points at an area the calculation did not report.
    expect(graph.links.some((link) => link.target === 'area:retired-area')).toBe(false);
    expect(graph.areas.find((area) => area.area === 'billing')).toMatchObject({ busFactor: 1, commits: 120 });
  });

  it('switches the map and the network to their large-team modes at the stated sizes', () => {
    expect([mapMode(150), mapMode(151)]).toEqual(['LABELLED', 'LARGE']);
    expect([networkMode(60), networkMode(61)]).toEqual(['FULL', 'AREAS']);
    // 61 people: only owners are drawn; everyone else is counted on their area until it is expanded.
    const crowd = Array.from({ length: 60 }, (_, index) => point(profile(String(100 + index), { areasActive: ['api'] })));
    const big = [point(sam), ...crowd];
    const apiArea = [{ area: 'api', commits: 200, contributors: 61, busFactor: 3 }, { area: 'billing', commits: 120, contributors: 1, busFactor: 1 }];
    const folded = ownershipGraph(big, apiArea, 'deal-1');
    expect(folded.mode).toBe('AREAS');
    expect(folded.people.map((person) => person.id)).toEqual(['person:02']);
    expect(folded.areas.find((area) => area.area === 'api')?.others).toBe(60);
    const opened = ownershipGraph(big, apiArea, 'deal-1', new Set(['api']));
    expect(opened.people).toHaveLength(61);
    expect(opened.areas.find((area) => area.area === 'api')?.others).toBe(0);
  });

  it('folds the areas chart after the 25 busiest', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ area: `area-${index}`, commits: 100 - index, contributors: 2, busFactor: 2 }));
    const { shown, other } = foldAreas(many);
    expect(shown).toHaveLength(25);
    expect(other).toEqual({ count: 5, commits: 75 + 74 + 73 + 72 + 71 });
    expect(foldAreas(many.slice(0, 3)).other).toBeNull();
  });

  it('reads table filters from the URL and builds the paged people query', () => {
    const filters = parsePeopleFilters({ q: ' grace ', tag: 'COORDINATOR', area: 'api', keep: 'true', page: '3' });
    expect(filters).toEqual({ q: 'grace', tag: 'COORDINATOR', area: 'api', keep: true, page: 3 });
    expect(peopleApiQuery(filters)).toBe('limit=50&cursor=100&q=grace&tag=COORDINATOR&area=api&keep=true');
    expect(parsePeopleFilters({ tag: 'SCORE', page: '-1', q: ['a', 'b'] })).toEqual({ q: '', tag: null, area: null, keep: false, page: 1 });
    expect(peoplePageHref('deal-1', filters, 1)).toBe('/deals/deal-1/engineering?q=grace&tag=COORDINATOR&area=api&keep=true#details');
  });
});
