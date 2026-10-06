import { z } from 'zod';
import type { ConnectionScope, ProviderAdapter } from '../contract';

export const JIRA_PROVIDER = 'jira';

/** Non-secret connection settings. Identical in FIXTURE and LIVE mode. */
export const jiraConnectionConfigSchema = z.strictObject({
  /** Jira Cloud site host, e.g. `example.atlassian.net`. */
  site: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/),
  projectKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/)).min(1).max(20),
});
export type JiraConnectionConfig = z.infer<typeof jiraConnectionConfigSchema>;

export const JIRA_STATUS_CATEGORIES = ['TO_DO', 'IN_PROGRESS', 'DONE'] as const;
export type JiraStatusCategory = (typeof JIRA_STATUS_CATEGORIES)[number];

/**
 * Normalized issue. Delivery facts only: no assignee, reporter, comments or
 * descriptions — people and free text stay out of this slice (spec phase 2).
 */
export interface JiraIssue {
  readonly key: string;
  readonly project: string;
  readonly type: 'Story' | 'Bug' | 'Task';
  readonly statusCategory: JiraStatusCategory;
  readonly priority: 'Highest' | 'High' | 'Medium' | 'Low' | null;
  /** Null when the team did not estimate (surfaced, never filled). */
  readonly storyPoints: number | null;
  readonly sprintId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly reopenCount: number;
}

export interface JiraSprint {
  readonly id: string;
  readonly project: string;
  readonly name: string;
  readonly state: 'closed' | 'active';
  readonly startAt: string;
  /** Null for an open-ended sprint (surfaced as a source issue). */
  readonly endAt: string | null;
  readonly committedPoints: number;
  readonly completedPoints: number;
}

export interface JiraIssuePage {
  readonly issues: readonly JiraIssue[];
  readonly nextCursor: string | null;
}

/** Normalized read-only Jira interface. */
export interface JiraAdapter extends ProviderAdapter<JiraIssue> {
  readonly version: string;
  listIssues(scope: ConnectionScope, options: { cursor: string | null; limit: number }): Promise<JiraIssuePage>;
  listSprints(scope: ConnectionScope): Promise<readonly JiraSprint[]>;
}

export class JiraAdapterError extends Error {
  constructor(
    readonly code: 'NOT_ENABLED' | 'UNKNOWN_SITE' | 'PERMISSION_DENIED' | 'INVALID_CURSOR',
    message: string,
  ) {
    super(message);
    this.name = 'JiraAdapterError';
  }
}
