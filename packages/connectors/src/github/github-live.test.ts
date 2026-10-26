import { newId } from '@pactlab/domain';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../credentials';
import { cassetteFetch, type FetchLike } from '../http/cassette';
import { AnonymousAuth, AppAuth, GITHUB_API_VERSION, TokenAuth } from './auth';
import { createGitHubEvidenceSource } from './evidence';
import { GitHubLiveAdapter, nextPage } from './live.adapter';
import { helloWorld, STATIC_AUTH } from './test-support';

const scope = (credentialRef: string | null = 'secretref:test/token') => ({
  organizationId: newId(),
  dealId: newId(),
  connectionId: newId(),
  credentialRef,
});

const HEAD = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d';

async function adapter(repository = 'octocat/Hello-World') {
  const replay = cassetteFetch(await helloWorld());
  return { replay, live: new GitHubLiveAdapter({ repository }, () => STATIC_AUTH, replay) };
}

describe('GitHub live adapter (recorded cassette)', () => {
  it('reads the default branch head', async () => {
    const { live } = await adapter();
    expect(await live.head(scope())).toEqual({ repository: 'octocat/Hello-World', defaultBranch: 'master', headSha: HEAD });
  });

  it('pages through history with line counts and paths from each commit', async () => {
    const { live, replay } = await adapter();
    const first = await live.listCommits(scope(), { cursor: null, limit: 1 });
    expect(first.commits).toHaveLength(1);
    expect(first.commits[0]).toMatchObject({ sha: HEAD, additions: 1, deletions: 1, authoredAt: '2012-03-06T23:06:50Z' });
    expect(first.commits[0]!.paths.length).toBeGreaterThan(0);
    expect(first.commits[0]!.authorIdentity).toMatch(/^author-[0-9a-f]{10}@example\.invalid$/);
    expect(first.nextCursor).toBe('2');
    const pages = [first];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await live.listCommits(scope(), { cursor, limit: 1 });
      pages.push(page);
      cursor = page.nextCursor;
    }
    expect(pages.flatMap((page) => page.commits.map((commit) => commit.sha))).toHaveLength(3);
    expect(replay.requests.every((request) => !request.includes('contents') && !request.includes('tarball'))).toBe(true);
    await expect(live.listCommits(scope(), { cursor: '../x', limit: 1 })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('validates credentials, reachability and read access', async () => {
    const { live } = await adapter();
    const validation = await live.validateConnection(scope());
    expect(validation.ok).toBe(true);
    expect(Object.fromEntries(validation.checks.map((check) => [check.name, check.status]))).toEqual({
      credentials: 'PASS',
      reachability: 'PASS',
      scopes: 'PASS',
      mappings: 'SKIPPED',
    });
  });

  it('reports a repository it cannot see as not found', async () => {
    const { live } = await adapter('octocat/pactlab-does-not-exist');
    await expect(live.head(scope())).rejects.toMatchObject({ code: 'UNKNOWN_REPOSITORY' });
    const validation = await live.validateConnection(scope());
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'reachability')?.detail).not.toContain('Not Found');
  });

  it('produces head evidence citing the exact commit', async () => {
    const { live } = await adapter();
    const pull = await createGitHubEvidenceSource(live, scope()).pull();
    expect(pull.records[0]).toEqual(
      expect.objectContaining({
        evidenceType: 'code.repository_head',
        sourceRecordId: `octocat/Hello-World@${HEAD}`,
        locator: { kind: 'git_commit', repository: 'octocat/Hello-World', commitSha: HEAD },
      }),
    );
    // Contributor activity from the recorded commits: pseudonymous keys only, never an email or login.
    const activity = pull.records.filter((record) => record.evidenceType === 'code.contributor_activity');
    expect(activity.length).toBeGreaterThan(0);
    // Recorded pull requests become pull-request evidence; the planted key in one title becomes a link.
    expect(pull.records.filter((record) => record.evidenceType === 'code.pull_request').map((record) => record.canonical['number'])).toEqual(['11617', '11616', '11615']);
    expect(pull.records.filter((record) => record.evidenceType === 'code.issue_link').map((record) => record.canonical['issueKey'])).toEqual(['HW-7']);
    expect(JSON.stringify(activity)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}|octocat"/i);
    expect(pull.people?.every((person) => person.system === 'github' && /^[0-9a-f]{16}$/.test(person.contributorKey))).toBe(true);
  });

  it('maps documented error responses without exposing payloads', async () => {
    const respond =
      (status: number, headers: Record<string, string> = {}): FetchLike =>
      async () =>
        new Response(JSON.stringify({ message: 'provider text' }), { status, headers });
    const cases: [number, Record<string, string>, string][] = [
      [401, {}, 'NO_CREDENTIAL'],
      [403, {}, 'PERMISSION_DENIED'],
      [403, { 'x-ratelimit-remaining': '0' }, 'RATE_LIMITED'],
      [429, { 'retry-after': '60' }, 'RATE_LIMITED'],
      [500, {}, 'UNAVAILABLE'],
    ];
    for (const [status, headers, code] of cases) {
      const live = new GitHubLiveAdapter({ repository: 'octocat/Hello-World' }, () => STATIC_AUTH, respond(status, headers));
      await expect(live.head(scope())).rejects.toMatchObject({ code });
    }
    const offline = new GitHubLiveAdapter({ repository: 'octocat/Hello-World' }, () => STATIC_AUTH, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offline.head(scope())).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('reads the next page number from GitHub link headers', () => {
    expect(nextPage('<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://x/?page=3>; rel="last"')).toBe('2');
    expect(nextPage('<https://api.github.com/repositories/1/commits?page=1>; rel="first"')).toBeNull();
    expect(nextPage(null)).toBeNull();
  });
});

describe('GitHub pull requests, reviews and checks (recorded, apache/kafka)', () => {
  async function kafka() {
    const url = new URL('../../../../fixtures/cassettes/github/apache__kafka-pulls.json', import.meta.url);
    const { readFile } = await import('node:fs/promises');
    const replay = cassetteFetch(JSON.parse(await readFile(url, 'utf8')));
    return new GitHubLiveAdapter({ repository: 'apache/kafka' }, () => new AnonymousAuth(), replay);
  }

  it('reads pull requests anonymously, with sanitized titles that carry Jira keys', async () => {
    const live = await kafka();
    const page = await live.listPullRequests(scope(null), { cursor: null, limit: 2 });
    expect(page.pullRequests.map((pull) => [pull.number, pull.state])).toEqual([
      [23948, 'MERGED'],
      [23945, 'MERGED'],
    ]);
    expect(page.pullRequests[0]?.title).toMatch(/^KAFKA-21353: /);
    expect(page.pullRequests[0]?.authorIdentity).toMatch(/^author-[0-9a-f]{10}$/);
    expect(page.pullRequests[0]?.baseBranch).toBe('trunk');
    await expect(live.listPullRequests(scope(null), { cursor: '0', limit: 2 })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('counts reviews and check runs by outcome', async () => {
    const live = await kafka();
    expect(await live.pullRequestReviews(scope(null), 23945)).toMatchObject({ approvals: 1, changesRequested: 0, commented: 2 });
    const checks = await live.checkRuns(scope(null), '5473459759108a95b1e67061c2389bdf003ffd36');
    expect(checks.total).toBe(18);
    expect(checks.failed).toBe(0);
    expect(checks.succeeded + checks.other + checks.pending).toBe(18);
    await expect(live.checkRuns(scope(null), 'not-a-sha')).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
});

describe('anonymous GitHub reads', () => {
  it('pass validation for a public repository, without a credential check', async () => {
    const live = new GitHubLiveAdapter({ repository: 'octocat/Hello-World' }, () => new AnonymousAuth(), cassetteFetch(await helloWorld()));
    const validation = await live.validateConnection(scope(null));
    expect(validation.ok).toBe(true);
    expect(validation.checks.find((check) => check.name === 'credentials')?.status).toBe('SKIPPED');
  });

  it('fail clearly for a private or unknown repository', async () => {
    const live = new GitHubLiveAdapter({ repository: 'octocat/pactlab-does-not-exist' }, () => new AnonymousAuth(), cassetteFetch(await helloWorld()));
    const validation = await live.validateConnection(scope(null));
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'reachability')?.detail).toMatch(/private or not found — connect it with the Pactlab GitHub App or a token/);
    const reportedPrivate = new GitHubLiveAdapter({ repository: 'octocat/Hello-World' }, () => new AnonymousAuth(), async () => new Response(JSON.stringify({ full_name: 'octocat/Hello-World', default_branch: 'master', private: true }), { status: 200 }));
    expect((await reportedPrivate.validateConnection(scope(null))).checks.find((check) => check.name === 'reachability')?.detail).toMatch(/private/);
  });

  it('never follows a redirect', async () => {
    const seen: (string | undefined)[] = [];
    const live = new GitHubLiveAdapter({ repository: 'octocat/Hello-World' }, () => new AnonymousAuth(), async (_url, init) => {
      seen.push(init?.redirect);
      return new Response(null, { status: 301, headers: { location: 'https://elsewhere.example/' } });
    });
    await expect(live.head(scope(null))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(seen).toEqual(['manual']);
  });
});

describe('GitHub credentials', () => {
  it('reads a seller token from the secret store', async () => {
    const secrets = new MemorySecretStore();
    await secrets.put('secretref:test/token', 'github_pat_example');
    await expect(new TokenAuth(secrets).token(scope())).resolves.toBe('github_pat_example');
    await expect(new TokenAuth(secrets).token(scope('secretref:test/missing'))).rejects.toMatchObject({ code: 'NO_CREDENTIAL' });
  });

  it('exchanges an app JWT for a token narrowed to one repository, and caches it', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const now = Date.parse('2026-10-09T12:00:00Z');
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    // Stub following the documented shapes of the installation and access-token endpoints.
    const stub: FetchLike = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith('/repos/acme/billing/installation')) return Response.json({ id: 42 });
      if (url.endsWith('/repos/acme/other/installation')) return Response.json({ message: 'Not Found' }, { status: 404 });
      if (url.endsWith('/app/installations/42/access_tokens'))
        return Response.json({ token: 'ghs_installation', expires_at: '2026-10-09T13:00:00Z' }, { status: 201 });
      return Response.json({}, { status: 500 });
    };
    const auth = new AppAuth({ appId: '123456', privateKeyPem: pem }, stub, () => now);
    expect(await auth.token(scope(), 'acme/billing')).toBe('ghs_installation');
    expect(await auth.token(scope(), 'acme/billing')).toBe('ghs_installation');
    expect(calls).toHaveLength(2);

    const jwt = calls[0]!.init!.headers!['authorization']!.replace('Bearer ', '');
    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey, { currentDate: new Date(now) });
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload).toMatchObject({ iss: '123456', iat: now / 1000 - 60, exp: now / 1000 - 60 + 540 });
    expect(calls[0]!.init!.headers!['x-github-api-version']).toBe(GITHUB_API_VERSION);
    expect(JSON.parse(calls[1]!.init!.body!)).toEqual({ repositories: ['billing'], permissions: { contents: 'read', metadata: 'read', pull_requests: 'read', checks: 'read' } });

    await expect(auth.token(scope(), 'acme/other')).rejects.toMatchObject({ code: 'NOT_INSTALLED' });
  });
});
