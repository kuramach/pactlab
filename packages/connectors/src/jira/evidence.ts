import type { EvidenceSource, NormalizedEvidence, SourceIssue } from '@pactlab/domain';
import type { ConnectionScope } from '../contract';
import { JIRA_PROVIDER, type JiraAdapter, type JiraIssue, type JiraSprint } from './types';

export const JIRA_ISSUE_EVIDENCE_TYPE = 'delivery.issue';
export const JIRA_SPRINT_EVIDENCE_TYPE = 'delivery.sprint';

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
        records: [...sprints.map((sprint) => sprintEvidence(site, sprint)), ...issues.map((issue) => issueEvidence(site, issue))],
        issues: sourceIssues,
      };
    },
  };
}
