import { SCALECO_ENGINEERS, scalecoIdentity, scalecoName } from '../github/scale-fixture';
import type { JiraIssue, JiraSprint } from './types';

/**
 * ScaleCo's Jira (T-055): delivery for the same 3,000 synthetic engineers as
 * the ScaleCo repository — 24 two-week sprints, issues rotating across the
 * team, a few coordinators who create most issues and commit little.
 * Deterministic and generated on first use only.
 */
export const SCALECO_SITE = 'scaleco.atlassian.net';
const DAY = 86_400_000;
const FIRST_SPRINT = Date.parse('2025-10-06T09:00:00Z');
const SPRINTS = 24;
const ISSUES_PER_SPRINT = 500;
/** Coordinators: the last 30 engineers report most issues. */
const COORDINATORS = 30;

function generate(): { sprints: JiraSprint[]; issues: JiraIssue[] } {
  const sprints: JiraSprint[] = [];
  const issues: JiraIssue[] = [];
  let seq = 1;
  for (let index = 0; index < SPRINTS; index += 1) {
    const start = FIRST_SPRINT + index * 14 * DAY;
    const id = `SC-S${index + 1}`;
    const last = index === SPRINTS - 1;
    let committed = 0;
    let completed = 0;
    for (let n = 0; n < ISSUES_PER_SPRINT; n += 1) {
      const number = seq++;
      const assignee = (index * ISSUES_PER_SPRINT + n) % (SCALECO_ENGINEERS - COORDINATORS);
      const reporter = SCALECO_ENGINEERS - COORDINATORS + (number % COORDINATORS);
      const done = last ? n % 3 === 0 : n % 10 !== 0;
      const points = 1 + (number % 5);
      committed += points;
      if (done) completed += points;
      issues.push({
        key: `SC-${number}`,
        project: 'SC',
        type: number % 7 === 0 ? 'Bug' : number % 4 === 0 ? 'Task' : 'Story',
        statusCategory: done ? 'DONE' : last ? 'IN_PROGRESS' : 'TO_DO',
        priority: number % 11 === 0 ? 'High' : 'Medium',
        storyPoints: number % 7 === 0 ? null : points,
        sprintId: id,
        createdAt: new Date(start - 2 * DAY).toISOString(),
        resolvedAt: done ? new Date(start + (3 + (number % 9)) * DAY).toISOString() : null,
        reopenCount: number % 29 === 0 ? 1 : 0,
        assignee: { accountId: scalecoIdentity(assignee), displayName: scalecoName(assignee) },
        reporter: { accountId: scalecoIdentity(reporter), displayName: scalecoName(reporter) },
        commentCount: 1 + (number % 4),
      });
    }
    sprints.push({
      id,
      project: 'SC',
      name: `SC Sprint ${index + 1}`,
      state: last ? 'active' : 'closed',
      startAt: new Date(start).toISOString(),
      endAt: new Date(start + 14 * DAY).toISOString(),
      committedPoints: committed,
      completedPoints: completed,
    });
  }
  return { sprints, issues };
}

let cached: ReturnType<typeof generate> | null = null;

/** The ScaleCo Jira site, generated once on first use. */
export function scalecoSite() {
  cached ??= generate();
  return { site: SCALECO_SITE, readableProjects: ['SC'] as readonly string[], sprints: cached.sprints, issues: cached.issues };
}
