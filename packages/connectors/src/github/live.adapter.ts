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
import { sanitizeMessage } from './messages';
import {
  GITHUB_PROVIDER,
  GitHubAdapterError,
  type CheckSummary,
  type CommitPage,
  type GitHubAdapter,
  type GitHubConnectionConfig,
  type PullRequestMetadata,
  type PullRequestPage,
  type RepositoryHead,
  type ReviewSummary,
} from './types';

export const GITHUB_LIVE_VERSION = 'github-live-2';
const TIMEOUT_MS = 15_000;
const MAX_PAGE = 100;

/** Picks the credential kind for a connection (Pactlab App or the seller's token). */
export type GitHubAuthResolver = (scope: ConnectionScope) => GitHubAuth | null;

interface CommitListItem {
  sha?: string;
  commit?: { author?: { name?: string | null; email?: string | null; date?: string } | null; committer?: { date?: string } | null; message?: string | null };
  author?: { login?: string } | null;
}

/** Documented fields of `GET /repos/{owner}/{repo}/pulls` items. */
interface PullItem {
  number?: number;
  state?: string;
  draft?: boolean;
  title?: string | null;
  user?: { login?: string } | null;
  created_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
  head?: { sha?: string } | null;
  base?: { ref?: string } | null;
}

interface ReviewItem {
  state?: string;
  user?: { login?: string } | null;
}

interface CheckRunsBody {
  total_count?: number;
  check_runs?: { status?: string; conclusion?: string | null }[];
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
 * Read-only GitHub over the REST API (version 2026-03-10). Metadata only:
 * repository, default branch, commits (dates, authors, line counts, paths and
 * sanitized messages), pull requests, reviews and check runs. Never
 * contents, diffs or archives; payloads are never logged.
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
        // Never follow a redirect: a moved repository is reported, not chased to another host.
        redirect: 'manual',
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
      throw new GitHubAdapterError(
        'UNKNOWN_REPOSITORY',
        auth.method === 'ANONYMOUS'
          ? 'This repository is private or not found — connect it with the Pactlab GitHub App or a token'
          : 'Repository not found, or the credential cannot see it',
      );
    if (response.status >= 300 && response.status < 400) throw new GitHubAdapterError('UNAVAILABLE', 'GitHub answered with a redirect; the repository may have moved');
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
        status: auth.method === 'ANONYMOUS' ? 'SKIPPED' : 'PASS',
        detail:
          auth.method === 'APP'
            ? 'Pactlab GitHub App is installed for this repository'
            : auth.method === 'TOKEN'
              ? 'Access token accepted'
              : 'No credential: public repositories only, at GitHub’s anonymous rate limit',
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
      const { body } = await this.get<{ full_name?: string; default_branch?: string; private?: boolean }>(scope, this.repoPath());
      // An anonymous read only ever sees public repositories; say so plainly if GitHub reports otherwise.
      if (auth.method === 'ANONYMOUS' && body.private === true)
        throw new GitHubAdapterError('NO_CREDENTIAL', 'This repository is private — connect it with the Pactlab GitHub App or a token');
      branch = body.default_branch ?? null;
      checks.push({ name: 'reachability', status: 'PASS', detail: `${body.full_name ?? this.config.repository} is reachable` });
    } catch (error) {
      checks.push({ name: 'reachability', status: 'FAIL', detail: safeDetail(error) });
    }
    try {
      if (!branch) throw new GitHubAdapterError('UNKNOWN_REPOSITORY', 'Repository not reachable');
      await this.get(scope, `${this.repoPath()}/commits`, { sha: branch, per_page: '1', page: '1' });
      let pulls = true;
      try {
        await this.get(scope, `${this.repoPath()}/pulls`, { state: 'all', per_page: '1', page: '1' });
      } catch (error) {
        if (!(error instanceof GitHubAdapterError) || error.code !== 'PERMISSION_DENIED') throw error;
        pulls = false;
      }
      checks.push({
        name: 'scopes',
        status: 'PASS',
        detail: pulls
          ? 'Commit history and pull requests are readable'
          : 'Commit history is readable; pull requests are not (grant Pull requests: read for review evidence)',
      });
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
        // Documented `commit.author.name`; kept only in the gated contributor directory.
        authorName: body.commit?.author?.name ?? body.author?.login ?? null,
        authoredAt: body.commit?.author?.date ?? '',
        committedAt: body.commit?.committer?.date ?? body.commit?.author?.date ?? '',
        additions: body.stats?.additions ?? 0,
        deletions: body.stats?.deletions ?? 0,
        paths: (body.files ?? []).map((file) => file.filename).filter((name): name is string => Boolean(name)),
        message: sanitizeMessage(body.commit?.message),
      });
    }
    return { commits, nextCursor: items.length === 0 ? null : nextPage(link) };
  }

  /** Contributor identities are supplied by the seller, not read from GitHub. */
  async identityMap(_scope: ConnectionScope): Promise<readonly ContributorIdentity[]> {
    return [];
  }

  /** One page of pull requests in every state, newest first. */
  async listPullRequests(scope: ConnectionScope, options: { cursor: string | null; limit: number }): Promise<PullRequestPage> {
    const page = options.cursor ?? '1';
    if (!/^[1-9]\d{0,5}$/.test(page)) throw new GitHubAdapterError('INVALID_CURSOR', 'Invalid cursor');
    const perPage = Math.min(Math.max(1, Math.trunc(options.limit)), MAX_PAGE);
    const { body: items, link } = await this.get<PullItem[]>(scope, `${this.repoPath()}/pulls`, {
      state: 'all',
      sort: 'created',
      direction: 'desc',
      per_page: String(perPage),
      page,
    });
    const pullRequests: PullRequestMetadata[] = [];
    for (const item of items) {
      if (typeof item.number !== 'number' || !item.head?.sha || !item.created_at) continue;
      pullRequests.push({
        number: item.number,
        state: item.merged_at ? 'MERGED' : item.state === 'closed' ? 'CLOSED' : 'OPEN',
        draft: item.draft === true,
        title: sanitizeMessage(item.title),
        authorIdentity: item.user?.login ?? 'unknown',
        createdAt: item.created_at,
        closedAt: item.closed_at ?? null,
        mergedAt: item.merged_at ?? null,
        headSha: item.head.sha,
        baseBranch: item.base?.ref ?? '',
      });
    }
    return { pullRequests, nextCursor: items.length === 0 ? null : nextPage(link) };
  }

  /** Submitted reviews on a pull request, by outcome (first 100; pending reviews are not submitted). */
  async pullRequestReviews(scope: ConnectionScope, number: number): Promise<ReviewSummary> {
    if (!Number.isSafeInteger(number) || number < 1) throw new GitHubAdapterError('INVALID_CURSOR', 'Invalid pull request number');
    const { body } = await this.get<ReviewItem[]>(scope, `${this.repoPath()}/pulls/${number}/reviews`, { per_page: String(MAX_PAGE), page: '1' });
    const count = (states: readonly string[]) => body.filter((review) => states.includes(review.state ?? '')).length;
    return {
      number,
      approvals: count(['APPROVED']),
      // The API reports CHANGES_REQUESTED; REQUEST_CHANGES is the event name, accepted defensively.
      changesRequested: count(['CHANGES_REQUESTED', 'REQUEST_CHANGES']),
      commented: count(['COMMENTED']),
      reviewerIdentities: [...new Set(body.filter((review) => review.state !== 'PENDING').map((review) => review.user?.login).filter((login): login is string => Boolean(login)))],
    };
  }

  /** Latest check runs on a commit, by outcome (first 100). */
  async checkRuns(scope: ConnectionScope, sha: string): Promise<CheckSummary> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new GitHubAdapterError('INVALID_CURSOR', 'Invalid commit SHA');
    const { body } = await this.get<CheckRunsBody>(scope, `${this.repoPath()}/commits/${sha}/check-runs`, { per_page: String(MAX_PAGE), page: '1' });
    const runs = body.check_runs ?? [];
    const done = runs.filter((run) => run.status === 'completed');
    const is = (conclusions: readonly string[]) => done.filter((run) => conclusions.includes(run.conclusion ?? '')).length;
    return {
      sha,
      total: body.total_count ?? runs.length,
      succeeded: is(['success']),
      failed: is(['failure', 'timed_out', 'action_required']),
      pending: runs.length - done.length,
      other: is(['neutral', 'skipped', 'cancelled', 'stale']),
    };
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
