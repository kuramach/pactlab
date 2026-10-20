import type { EvidenceSource, NormalizedEvidence, ObservedPerson, SourceIssue } from '@pactlab/domain';
import type { ConnectionScope } from '../contract';
import { contributorKey, monthOf } from '../people';
import { JIRA_PROVIDER, type JiraAdapter, type JiraIssue, type JiraSprint } from './types';

export const JIRA_ISSUE_EVIDENCE_TYPE = 'delivery.issue';
export const JIRA_SPRINT_EVIDENCE_TYPE = 'delivery.sprint';
export const DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE = 'delivery.contributor_activity';

interface DeliveryBucket {
  key: string;
  month: string;
  resolved: number;
  points: number;
  created: number;
  comments: number;
  reopened: number;
  sprints: Set<string>;
}

/**
 * Delivery work per contributor per month: issues resolved as assignee
 * (with story points and reopens), issues created as reporter, and comment
 * counts. Identities become pseudonymous keys; no issue text is carried.
 */
function contributorActivity(site: string, dealId: string, issues: readonly JiraIssue[]): NormalizedEvidence[] {
  const buckets = new Map<string, DeliveryBucket>();
  const bucket = (accountId: string, month: string) => {
    const key = contributorKey(dealId, accountId);
    const id = `${key}:${month}`;
    const found = buckets.get(id) ?? { key, month, resolved: 0, points: 0, created: 0, comments: 0, reopened: 0, sprints: new Set<string>() };
    buckets.set(id, found);
    return found;
  };
  for (const issue of issues) {
    if (issue.reporter) {
      const created = bucket(issue.reporter.accountId, monthOf(issue.createdAt));
      created.created += 1;
      // Comments are attributed to the reporter: the fixture models the coordinator's triage.
      created.comments += issue.commentCount;
    }
    if (issue.assignee && issue.resolvedAt) {
      const resolved = bucket(issue.assignee.accountId, monthOf(issue.resolvedAt));
      resolved.resolved += 1;
      resolved.points += issue.storyPoints ?? 0;
      resolved.reopened += issue.reopenCount > 0 ? 1 : 0;
      if (issue.sprintId) resolved.sprints.add(issue.sprintId);
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.key.localeCompare(b.key))
    .map((entry) => {
      const canonical = {
        site,
        contributorKey: entry.key,
        month: entry.month,
        issuesResolved: String(entry.resolved),
        pointsResolved: String(entry.points),
        issuesCreated: String(entry.created),
        comments: String(entry.comments),
        resolvedReopened: String(entry.reopened),
        sprints: String(entry.sprints.size),
      };
      return {
        evidenceType: DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE,
        sourceSystem: JIRA_PROVIDER,
        sourceRecordId: `${site}:${entry.key}:${entry.month}`,
        observedAt: `${entry.month}-01T00:00:00.000Z`,
        canonical,
        locator: { kind: 'provider_record', system: JIRA_PROVIDER, site, resource: 'contributor_activity', id: `${entry.key}:${entry.month}` },
        quote: JSON.stringify(canonical),
      };
    });
}

function peopleOf(dealId: string, issues: readonly JiraIssue[]): ObservedPerson[] {
  const people = new Map<string, ObservedPerson>();
  for (const issue of issues) {
    for (const who of [issue.assignee, issue.reporter]) {
      if (!who || people.has(who.accountId)) continue;
      people.set(who.accountId, {
        contributorKey: contributorKey(dealId, who.accountId),
        system: 'jira',
        identity: who.accountId,
        displayName: who.displayName,
        status: 'UNKNOWN',
      });
    }
  }
  return [...people.values()];
}

const text = (value: number | string | null) => (value === null ? null : String(value));

function issueEvidence(site: string, issue: JiraIssue): NormalizedEvidence {
  const canonical = {
    key: issue.key,
    project: issue.project,
    type: issue.type,
    statusCategory: issue.statusCategory,
    priority: issue.priority,
    storyPoints: text(issue.storyPoints),
    sprintId: issue.sprintId,
    createdAt: issue.createdAt,
    resolvedAt: issue.resolvedAt,
    reopenCount: String(issue.reopenCount),
  };
  return {
    evidenceType: JIRA_ISSUE_EVIDENCE_TYPE,
    sourceSystem: JIRA_PROVIDER,
    sourceRecordId: issue.key,
    observedAt: issue.resolvedAt ?? issue.createdAt,
    canonical,
    locator: { kind: 'provider_record', system: JIRA_PROVIDER, site, resource: 'issue', id: issue.key },
    quote: JSON.stringify(canonical),
  };
}

function sprintEvidence(site: string, sprint: JiraSprint): NormalizedEvidence {
  const canonical = {
    id: sprint.id,
    project: sprint.project,
    name: sprint.name,
    state: sprint.state,
    startAt: sprint.startAt,
    endAt: sprint.endAt,
    committedPoints: String(sprint.committedPoints),
    completedPoints: String(sprint.completedPoints),
  };
  return {
    evidenceType: JIRA_SPRINT_EVIDENCE_TYPE,
    sourceSystem: JIRA_PROVIDER,
    sourceRecordId: `sprint:${sprint.id}`,
    observedAt: sprint.endAt ?? sprint.startAt,
    canonical,
    locator: { kind: 'provider_record', system: JIRA_PROVIDER, site, resource: 'sprint', id: sprint.id },
    quote: JSON.stringify(canonical),
  };
}

/**
 * Jira issues and sprints as evidence, through the same `EvidenceSource`
 * port and sync engine as CSV and GitHub. Gaps (unreadable projects,
 * unestimated work, open-ended sprints) are surfaced as source issues,
 * never silently filled.
 */
export function createJiraEvidenceSource(
  adapter: JiraAdapter & { readonly config: { site: string; projectKeys: readonly string[] } },
  scope: ConnectionScope,
  unreadableProjects: readonly string[] = [],
): EvidenceSource {
  return {
    provider: JIRA_PROVIDER,
    version: adapter.version,
    async pull() {
      const site = adapter.config.site;
      const issues: JiraIssue[] = [];
      let cursor: string | null = null;
      do {
        const page = await adapter.listIssues(scope, { cursor, limit: 100 });
        issues.push(...page.issues);
        cursor = page.nextCursor;
      } while (cursor !== null);
      const sprints = await adapter.listSprints(scope);

      const sourceIssues: SourceIssue[] = [
        ...unreadableProjects.map((project) => ({
          dataset: `${site}/${project}`,
          row: null,
          code: 'PERMISSION_DENIED' as const,
          detail: `Project ${project} is not readable by this installation`,
        })),
        ...issues
          .filter((issue) => issue.type !== 'Bug' && issue.storyPoints === null)
          .map((issue) => ({
            dataset: `${site}/${issue.project}`,
            row: null,
            code: 'MISSING_FIELD' as const,
            detail: `${issue.key} has no story-point estimate`,
          })),
        ...sprints
          .filter((sprint) => sprint.endAt === null)
          .map((sprint) => ({
            dataset: `${site}/${sprint.project}`,
            row: null,
            code: 'MISSING_FIELD' as const,
            detail: `${sprint.name} has no end date`,
          })),
      ];
      return {
        records: [
          ...sprints.map((sprint) => sprintEvidence(site, sprint)),
          ...issues.map((issue) => issueEvidence(site, issue)),
          ...contributorActivity(site, scope.dealId, issues),
        ],
        issues: sourceIssues,
        people: peopleOf(scope.dealId, issues),
      };
    },
  };
}
