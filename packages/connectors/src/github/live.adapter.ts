import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import {
  boundedLimit,
  type ConnectionScope,
  type DryRunResult,
  type ValidationCheck,
  type ValidationResult,
} from '../contract';
import type { FetchLike } from '../http/cassette';
import { GITHUB_API, githubHeaders, type GitHubAuth } from './auth';
import {
  GITHUB_PROVIDER,
  GitHubAdapterError,
  type CommitPage,
  type GitHubAdapter,
  type GitHubConnectionConfig,
  type RepositoryHead,
} from './types';

export const GITHUB_LIVE_VERSION = 'github-live-1';
const TIMEOUT_MS = 15_000;
const MAX_PAGE = 100;

/** Picks the credential kind for a connection (Pactlab App or the seller's token). */
export type GitHubAuthResolver = (scope: ConnectionScope) => GitHubAuth | null;

interface CommitListItem {
  sha?: string;
  commit?: { author?: { email?: string | null; date?: string } | null; committer?: { date?: string } | null };
  author?: { login?: string } | null;
}

interface CommitDetail extends CommitListItem {
  stats?: { additions?: number; deletions?: number };
  files?: { filename?: string }[];
}

/** The `page` of the `rel="next"` link, or null. GitHub's links may use `/repositories/<id>` paths, so only the page is read. */
export function nextPage(link: string | null): string | null {
  const next = link
    ?.split(',')
    .map((part) => part.trim())
    .find((part) => /;\s*rel="next"/.test(part));
  const url = next ? /<([^>]+)>/.exec(next)?.[1] : undefined;
  return url ? new URL(url).searchParams.get('page') : null;
}

/**
 * Read-only GitHub over the REST API (version 2026-03-10). Commit metadata
 * only: repository, default branch, commit dates, authors, line counts and
 * paths. Never contents, diffs or archives; payloads are never logged.
 */
export class GitHubLiveAdapter implements GitHubAdapter {
  readonly provider = GITHUB_PROVIDER;
  readonly mode = 'LIVE' as const;
  readonly version = GITHUB_LIVE_VERSION;

  constructor(
    readonly config: GitHubConnectionConfig,
    private readonly resolveAuth: GitHubAuthResolver = () => null,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async get<T>(scope: ConnectionScope, path: string, query: Record<string, string> = {}): Promise<{ body: T; link: string | null }> {
    const auth = this.resolveAuth(scope);
    if (!auth) throw new GitHubAdapterError('NO_CREDENTIAL', 'No GitHub credential is configured for this connection');
    const token = await auth.token(scope, this.config.repository);
    const search = new URLSearchParams(query).toString();
    let response: Response;
    try {
      response = await this.fetchImpl(`${GITHUB_API}${path}${search ? `?${search}` : ''}`, {
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof GitHubAdapterError) throw error;
      throw new GitHubAdapterError('UNAVAILABLE', 'GitHub could not be reached');
    }
    if (response.ok) return { body: (await response.json()) as T, link: response.headers.get('link') };
    const limited = response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after');
    if ((response.status === 403 || response.status === 429) && limited)
      throw new GitHubAdapterError('RATE_LIMITED', 'GitHub rate limit reached; retry later');
    if (response.status === 401) throw new GitHubAdapterError('NO_CREDENTIAL', 'GitHub rejected the credential');
    if (response.status === 403) throw new GitHubAdapterError('PERMISSION_DENIED', 'The credential cannot read this repository');
    if (response.status === 404)
      throw new GitHubAdapterError('UNKNOWN_REPOSITORY', 'Repository not found, or the credential cannot see it');
    throw new GitHubAdapterError('UNAVAILABLE', `GitHub answered ${response.status}`);
  }

  private repoPath(): string {
    return `/repos/${this.config.repository}`;
  }

  async validateConnection(scope: ConnectionScope): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];
    const auth = this.resolveAuth(scope);
    try {
      if (!auth) throw new GitHubAdapterError('NO_CREDENTIAL', 'No GitHub credential is configured');
      await auth.token(scope, this.config.repository);
      checks.push({
        name: 'credentials',
        status: 'PASS',
        detail: auth.method === 'APP' ? 'Pactlab GitHub App is installed for this repository' : 'Access token accepted',
      });
    } catch (error) {
      checks.push({ name: 'credentials', status: 'FAIL', detail: safeDetail(error) });
      checks.push({ name: 'reachability', status: 'SKIPPED', detail: 'Needs a working credential' });
      checks.push({ name: 'scopes', status: 'SKIPPED', detail: 'Needs a working credential' });
      checks.push(mappingCheck());
      return { ok: false, checks };
    }
    let branch: string | null = null;
    try {
      const { body } = await this.get<{ full_name?: string; default_branch?: string }>(scope, this.repoPath());
      branch = body.default_branch ?? null;
      checks.push({ name: 'reachability', status: 'PASS', detail: `${body.full_name ?? this.config.repository} is reachable` });
    } catch (error) {
      checks.push({ name: 'reachability', status: 'FAIL', detail: safeDetail(error) });
    }
    try {
      if (!branch) throw new GitHubAdapterError('UNKNOWN_REPOSITORY', 'Repository not reachable');
      await this.get(scope, `${this.repoPath()}/commits`, { sha: branch, per_page: '1', page: '1' });
      checks.push({ name: 'scopes', status: 'PASS', detail: 'Commit history is readable (Contents: read)' });
    } catch (error) {
      checks.push({ name: 'scopes', status: 'FAIL', detail: safeDetail(error) });
    }
    checks.push(mappingCheck());
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  async dryRun(scope: ConnectionScope, options: { limit: number }): Promise<DryRunResult<CommitMetadata>> {
    const page = await this.listCommits(scope, { cursor: null, limit: boundedLimit(options.limit) });
    return { sample: page.commits, truncated: page.nextCursor !== null };
  }

  async head(scope: ConnectionScope): Promise<RepositoryHead> {
    const { body: repo } = await this.get<{ default_branch?: string }>(scope, this.repoPath());
    if (!repo.default_branch) throw new GitHubAdapterError('UNKNOWN_REPOSITORY', 'Repository has no default branch');
    const { body: commits } = await this.get<CommitListItem[]>(scope, `${this.repoPath()}/commits`, {
      sha: repo.default_branch,
      per_page: '1',
      page: '1',
    });
    const sha = commits[0]?.sha;
    if (!sha) throw new GitHubAdapterError('UNKNOWN_REPOSITORY', 'Repository has no commits');
    return { repository: this.config.repository, defaultBranch: repo.default_branch, headSha: sha };
  }

  /** One page of history on the default branch; line counts and paths come from each commit. */
  async listCommits(scope: ConnectionScope, options: { cursor: string | null; limit: number }): Promise<CommitPage> {
    const page = options.cursor ?? '1';
    if (!/^[1-9]\d{0,5}$/.test(page)) throw new GitHubAdapterError('INVALID_CURSOR', 'Invalid cursor');
    const perPage = Math.min(Math.max(1, Math.trunc(options.limit)), MAX_PAGE);
    const { body: repo } = await this.get<{ default_branch?: string }>(scope, this.repoPath());
    const { body: items, link } = await this.get<CommitListItem[]>(scope, `${this.repoPath()}/commits`, {
      sha: repo.default_branch ?? '',
      per_page: String(perPage),
      page,
    });
    const commits: CommitMetadata[] = [];
    for (const item of items) {
      if (!item.sha) continue;
      const { body } = await this.get<CommitDetail>(scope, `${this.repoPath()}/commits/${item.sha}`);
      commits.push({
        sha: item.sha,
        authorIdentity: body.commit?.author?.email ?? body.author?.login ?? 'unknown',
        authoredAt: body.commit?.author?.date ?? '',
        committedAt: body.commit?.committer?.date ?? body.commit?.author?.date ?? '',
        additions: body.stats?.additions ?? 0,
        deletions: body.stats?.deletions ?? 0,
        paths: (body.files ?? []).map((file) => file.filename).filter((name): name is string => Boolean(name)),
      });
    }
    return { commits, nextCursor: items.length === 0 ? null : nextPage(link) };
  }

  /** Contributor identities are supplied by the seller, not read from GitHub. */
  async identityMap(_scope: ConnectionScope): Promise<readonly ContributorIdentity[]> {
    return [];
  }
}

function mappingCheck(): ValidationCheck {
  return {
    name: 'mappings',
    status: 'SKIPPED',
    detail: 'Contributor identity map is supplied by the seller separately',
  };
}

/** Error text safe for the onboarding UI: adapter messages only, never provider payloads. */
function safeDetail(error: unknown): string {
  return error instanceof GitHubAdapterError ? error.message : 'GitHub could not be checked';
}
