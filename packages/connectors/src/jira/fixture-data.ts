import { FIXTURE_NAMES } from '../github/fixture-data';
import { SCALECO_SITE, scalecoSite } from './scale-fixture';
import type { JiraIssue, JiraPerson, JiraSprint } from './types';

/**
 * Deterministic synthetic Jira sites. Generated, not recorded, so they never
 * drift; no real people, no free text.
 */
export interface JiraFixtureSite {
  readonly site: string;
  /** Projects the fixture installation may read. */
  readonly readableProjects: readonly string[];
  readonly sprints: readonly JiraSprint[];
  readonly issues: readonly JiraIssue[];
}

interface SprintPlan {
  readonly committed: number;
  readonly completed: number;
  /** Bugs opened during the sprint, and how many of them were fixed. */
  readonly bugsOpened: number;
  readonly bugsFixed: number;
}

const DAY = 86_400_000;
const FIRST_SPRINT_START = Date.parse('2026-06-22T09:00:00Z');
const PRIORITIES = ['High', 'Medium', 'Medium', 'Low'] as const;

/** Who does the work: assignees rotate; the lead reports most issues and comments most. */
interface PeoplePlan {
  readonly assignees: readonly string[];
  readonly reporters: readonly string[];
  /** Extra comments per issue by the coordinator (counted on the reporter). */
  readonly coordinatorComments: number;
}

const person = (accountId: string | undefined): JiraPerson | null =>
  accountId ? { accountId, displayName: FIXTURE_NAMES[accountId] ?? null } : null;

function generate(
  project: string,
  plans: readonly SprintPlan[],
  options: { unestimatedEvery?: number; lastSprintOpenEnded?: boolean; staleHighestBugs?: number; reopenEvery?: number; people?: PeoplePlan } = {},
): { sprints: JiraSprint[]; issues: JiraIssue[] } {
  const people = options.people;
  const involved = (n: number) => ({
    assignee: person(people?.assignees[n % people.assignees.length]),
    reporter: person(people?.reporters[n % people.reporters.length]),
    commentCount: people ? 1 + (n % 3) + (people.reporters[n % people.reporters.length] === people.reporters[0] ? people.coordinatorComments : 0) : 0,
  });
  const sprints: JiraSprint[] = [];
  const issues: JiraIssue[] = [];
  let seq = 1;
  plans.forEach((plan, index) => {
    const start = FIRST_SPRINT_START + index * 14 * DAY;
    const end = start + 14 * DAY;
    const last = index === plans.length - 1;
    const id = `${project}-S${index + 1}`;
    sprints.push({
      id,
      project,
      name: `${project} Sprint ${index + 1}`,
      state: last ? 'active' : 'closed',
      startAt: new Date(start).toISOString(),
      endAt: last && options.lastSprintOpenEnded ? null : new Date(end).toISOString(),
      committedPoints: plan.committed,
      completedPoints: plan.completed,
    });
    // Stories of 5 points; completion follows the plan.
    for (let points = 0; points < plan.committed; points += 5) {
      const done = points < plan.completed;
      const n = seq++;
      issues.push({
        key: `${project}-${n}`,
        project,
        type: n % 4 === 0 ? 'Task' : 'Story',
        statusCategory: done ? 'DONE' : last ? 'IN_PROGRESS' : 'TO_DO',
        priority: PRIORITIES[n % PRIORITIES.length] ?? 'Medium',
        storyPoints: options.unestimatedEvery && n % options.unestimatedEvery === 0 ? null : 5,
        sprintId: id,
        createdAt: new Date(start - 3 * DAY).toISOString(),
        resolvedAt: done ? new Date(start + (10 + (n % 4)) * DAY).toISOString() : null,
        reopenCount: options.reopenEvery && n % options.reopenEvery === 0 ? 1 : 0,
        ...involved(n),
      });
    }
    for (let b = 0; b < plan.bugsOpened; b += 1) {
      const fixed = b < plan.bugsFixed;
      const n = seq++;
      issues.push({
        key: `${project}-${n}`,
        project,
        type: 'Bug',
        statusCategory: fixed ? 'DONE' : 'TO_DO',
        priority: b === 0 ? 'High' : 'Medium',
        storyPoints: null,
        sprintId: fixed ? id : null,
        createdAt: new Date(start + (2 + b) * DAY).toISOString(),
        resolvedAt: fixed ? new Date(start + (6 + b) * DAY).toISOString() : null,
        reopenCount: options.reopenEvery && n % options.reopenEvery === 0 ? 2 : 0,
        ...involved(n),
      });
    }
  });
  // Long-open, highest-priority defects (backlog, no sprint).
  for (let i = 0; i < (options.staleHighestBugs ?? 0); i += 1) {
    issues.push({
      key: `${project}-${seq++}`,
      project,
      type: 'Bug',
      statusCategory: 'TO_DO',
      priority: 'Highest',
      storyPoints: null,
      sprintId: null,
      createdAt: new Date(FIRST_SPRINT_START - (60 + i * 15) * DAY).toISOString(),
      resolvedAt: null,
      reopenCount: 0,
      assignee: null,
      reporter: person(people?.reporters[0]),
      commentCount: people ? 2 : 0,
    });
  }
  return { sprints, issues };
}

const healthy = generate('HC', [
  { committed: 40, completed: 40, bugsOpened: 2, bugsFixed: 2 },
  { committed: 40, completed: 35, bugsOpened: 3, bugsFixed: 3 },
  { committed: 45, completed: 45, bugsOpened: 2, bugsFixed: 2 },
  { committed: 45, completed: 40, bugsOpened: 2, bugsFixed: 1 },
  { committed: 45, completed: 45, bugsOpened: 1, bugsFixed: 1 },
  { committed: 45, completed: 20, bugsOpened: 1, bugsFixed: 0 },
], {
  people: {
    assignees: ['hc-dev-01', 'hc-dev-02', 'hc-dev-03', 'hc-dev-04', 'hc-dev-05', 'hc-dev-06', 'hc-lead-01'],
    // The lead and a product manager (who never commits) create and triage the work.
    reporters: ['hc-lead-01', 'hc-pm-01', 'hc-lead-01'],
    coordinatorComments: 4,
  },
});

// TroubledCo: completion falls sprint over sprint, the bug backlog grows,
// highest-priority defects sit unresolved for months and fixes get reopened.
const troubled = generate(
  'TC',
  [
    { committed: 50, completed: 40, bugsOpened: 5, bugsFixed: 3 },
    { committed: 50, completed: 35, bugsOpened: 6, bugsFixed: 3 },
    { committed: 50, completed: 30, bugsOpened: 7, bugsFixed: 2 },
    { committed: 55, completed: 25, bugsOpened: 8, bugsFixed: 2 },
    { committed: 55, completed: 20, bugsOpened: 9, bugsFixed: 2 },
    { committed: 55, completed: 10, bugsOpened: 9, bugsFixed: 1 },
  ],
  {
    staleHighestBugs: 4,
    reopenEvery: 5,
    people: {
      // tc-dev-01 alone maintains billing in code; the lead coordinates delivery and commits little.
      assignees: ['tc-dev-01', 'tc-dev-02', 'tc-dev-03', 'tc-dev-04', 'tc-lead-01', 'tc-lead-01'],
      reporters: ['tc-lead-01'],
      coordinatorComments: 3,
    },
  },
);

// SparseCo: unestimated work, an open-ended sprint, and a project the
// installation cannot read.
const sparse = generate(
  'SP',
  [
    { committed: 20, completed: 15, bugsOpened: 1, bugsFixed: 1 },
    { committed: 25, completed: 10, bugsOpened: 2, bugsFixed: 0 },
    { committed: 20, completed: 5, bugsOpened: 1, bugsFixed: 0 },
  ],
  { unestimatedEvery: 3, lastSprintOpenEnded: true, people: { assignees: ['sc-dev-01', 'sc-dev-02'], reporters: ['sc-dev-01'], coordinatorComments: 0 } },
);

export const JIRA_FIXTURES: Readonly<Record<string, JiraFixtureSite>> = {
  'healthyco.atlassian.net': { site: 'healthyco.atlassian.net', readableProjects: ['HC'], ...healthy },
  'troubledco.atlassian.net': { site: 'troubledco.atlassian.net', readableProjects: ['TC'], ...troubled },
  'sparseco.atlassian.net': { site: 'sparseco.atlassian.net', readableProjects: ['SP'], ...sparse },
  // 3,000 engineers (T-055), generated the first time it is read.
  get [SCALECO_SITE]() {
    return scalecoSite();
  },
};
