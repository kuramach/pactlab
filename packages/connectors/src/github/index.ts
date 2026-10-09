import type { CommitMetadata } from '@pactlab/domain';
import type { ConnectionMode } from '../contract';
import type { FetchLike } from '../http/cassette';
import { GitHubFixtureAdapter } from './fixture.adapter';
import { GitHubLiveAdapter, type GitHubAuthResolver } from './live.adapter';
import { githubConnectionConfigSchema, type GitHubAdapter } from './types';

export * from './auth';
export * from './evidence';
export * from './fixture.adapter';
export * from './live.adapter';
export * from './types';
export { GITHUB_FIXTURES } from './fixture-data';

/** The only place that looks at mode; callers see the normalized adapter. */
export function createGitHubAdapter(
  mode: ConnectionMode,
  config: unknown,
  live: { resolveAuth?: GitHubAuthResolver; fetch?: FetchLike } = {},
): GitHubAdapter | null {
  const parsed = githubConnectionConfigSchema.safeParse(config);
  if (!parsed.success) return null;
  return mode === 'FIXTURE'
    ? new GitHubFixtureAdapter(parsed.data)
    : new GitHubLiveAdapter(parsed.data, live.resolveAuth, live.fetch);
}

/** Read every commit page; the bounded page size keeps each call small. */
export async function readAllCommits(
  adapter: GitHubAdapter,
  scope: Parameters<GitHubAdapter['listCommits']>[0],
  pageSize = 100,
) {
  const commits: CommitMetadata[] = [];
  let cursor: string | null = null;
  do {
    const page = await adapter.listCommits(scope, { cursor, limit: pageSize });
    commits.push(...page.commits);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return commits;
}
