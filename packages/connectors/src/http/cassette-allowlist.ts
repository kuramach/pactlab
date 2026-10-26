/**
 * Keys a sanitized cassette may hold anywhere in a response body, per
 * provider. The recorder (`scripts/record-cassettes.ts`) prunes recordings to
 * these keys and `cassettes.test.ts` fails on anything else, so a provider
 * payload can never land in the repository whole.
 */
export const CASSETTE_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  github: new Set([
    'full_name', 'default_branch', 'visibility', 'private', 'sha', 'commit', 'author', 'committer', 'date', 'email', 'login',
    'stats', 'additions', 'deletions', 'total', 'files', 'filename', 'message',
    // Pull requests, reviews and check runs (T-082).
    'number', 'state', 'draft', 'title', 'user', 'created_at', 'closed_at', 'merged_at', 'head', 'base', 'ref',
    'total_count', 'check_runs', 'status', 'conclusion',
  ]),
  // Jira REST v2/v3 and Agile 1.0 shapes (T-082, T-074); people pseudonymised.
  jira: new Set([
    'deploymentType', 'id', 'name', 'schema', 'custom', 'statusCategory', 'key', 'errorMessages', 'accountId',
    'startAt', 'maxResults', 'total', 'issues', 'fields', 'issuetype', 'status', 'priority', 'created', 'resolutiondate',
    'assignee', 'reporter', 'displayName', 'comment', 'changelog', 'histories', 'items', 'field', 'from', 'to',
    'nextPageToken', 'isLast', 'values', 'type', 'state', 'boardId', 'startDate', 'endDate',
    'customfield_12310293', 'customfield_12310921', 'customfield_12310940', 'customfield_10016', 'customfield_10020',
  ]),
};
