import { z } from 'zod';
import type { ConnectionScope, ProviderAdapter } from '../contract';

export const JIRA_PROVIDER = 'jira';

/**
 * A DNS host name: lowercase labels, at least one dot, an alphabetic top
 * level. IP literals, `localhost`, ports and user info can never match.
 * Which hosts a deployment may reach is the operator's allowlist
 * (`allowlist.ts`), checked on every connection and every request.
 */
export const JIRA_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Non-secret connection settings. Identical in FIXTURE and LIVE mode. */
export const jiraConnectionConfigSchema = z.strictObject({
  /** Jira host: an Atlassian Cloud site (`example.atlassian.net`) or an allowlisted self-hosted server. */
  site: z.string().regex(JIRA_HOST),
  /** Context path of a self-hosted server, e.g. `/jira`; none on Cloud. */
  basePath: z
    .string()
    .regex(/^(?:\/[a-z0-9][a-z0-9._-]{0,62}){1,3}$/)
    .refine((value) => !value.split('/').some((part) => part === '.' || part === '..'), 'Not a path')
    .optional(),
  projectKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/)).min(1).max(20),
});
export type JiraConnectionConfig = z.infer<typeof jiraConnectionConfigSchema>;

export const JIRA_STATUS_CATEGORIES = ['TO_DO', 'IN_PROGRESS', 'DONE'] as const;
export type JiraStatusCategory = (typeof JIRA_STATUS_CATEGORIES)[number];

/** A Jira user on an issue: account id and display name. Names reach only the gated directory. */
export interface JiraPerson {
  readonly accountId: string;
  readonly displayName: string | null;
}

/**
 * Normalized issue: delivery facts plus who was involved (assignee,
 * reporter, comment count). No descriptions or comment text — free text
 * stays out. People feed contributor profiles under the names gate.
 */
export interface JiraIssue {
  readonly key: string;
  readonly project: string;
  /** Normalized: bug or defect → Bug; story, feature, improvement or epic → Story; anything else → Task. */
  readonly type: 'Story' | 'Bug' | 'Task';
  /** The site's own issue type name (e.g. `Improvement`), when it differs from the normalized type. */
  readonly providerType?: string;
  readonly statusCategory: JiraStatusCategory;
  readonly priority: 'Highest' | 'High' | 'Medium' | 'Low' | null;
  /** Null when the team did not estimate (surfaced, never filled). */
  readonly storyPoints: number | null;
  readonly sprintId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly reopenCount: number;
  readonly assignee: JiraPerson | null;
  readonly reporter: JiraPerson | null;
  readonly commentCount: number;
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
  /** What this page could not read (unreadable projects, no issue history); surfaced as source issues. */
  readonly gaps?: readonly JiraGap[];
}

/** A gap a read could not fill, surfaced as a source issue. */
export interface JiraGap {
  readonly code: 'PERMISSION_DENIED' | 'MISSING_FIELD';
  readonly detail: string;
}

/** Normalized read-only Jira interface. */
export interface JiraAdapter extends ProviderAdapter<JiraIssue> {
  readonly version: string;
  listIssues(scope: ConnectionScope, options: { cursor: string | null; limit: number }): Promise<JiraIssuePage>;
  listSprints(scope: ConnectionScope): Promise<readonly JiraSprint[]>;
  /**
   * The issues behind a set of keys (at most 50), e.g. those named by commit
   * messages and pull requests (T-074). Keys with no visible issue are simply
   * absent; only configured projects are read.
   */
  issuesByKey(scope: ConnectionScope, keys: readonly string[]): Promise<readonly JiraIssue[]>;
}

export const MAX_KEYS_PER_LOOKUP = 50;
export const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,7}$/;

export class JiraAdapterError extends Error {
  constructor(
    readonly code:
      | 'NOT_ENABLED'
      | 'UNKNOWN_SITE'
      | 'SITE_NOT_ALLOWED'
      | 'PERMISSION_DENIED'
      | 'INVALID_CURSOR'
      | 'NO_CREDENTIAL'
      | 'RATE_LIMITED'
      | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'JiraAdapterError';
  }
}
