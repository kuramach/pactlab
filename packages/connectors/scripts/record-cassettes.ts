/**
 * Records the Apache Kafka integration-test cassettes (T-074) by running the
 * live adapters against the public targets — apache/kafka on GitHub and
 * project KAFKA on issues.apache.org/jira — through a fetch that records each
 * exchange. Every body is pruned to the cassette allow-list and people are
 * pseudonymised before anything is written. Run by hand, never in CI:
 *
 *   pnpm --filter @pactlab/api exec tsx ../../packages/connectors/scripts/record-cassettes.ts
 *
 * Anonymous by default; set GITHUB_TOKEN to record GitHub authenticated
 * (the token is used for the requests only and is never written).
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { issueKeysIn } from '../src/cross-links';
import { AnonymousAuth, GitHubLiveAdapter, sanitizeMessage, type GitHubAuth } from '../src/github';
import { normalizeQuery, type Cassette, type CassetteInteraction, type FetchLike } from '../src/http/cassette';
import { CASSETTE_KEYS } from '../src/http/cassette-allowlist';
import { JiraLiveAdapter } from '../src/jira';

const OUT = new URL('../../../fixtures/cassettes/', import.meta.url);
const hash = (value: string) => createHash('sha256').update(`pactlab-cassette:${value}`).digest('hex').slice(0, 10);
const PEOPLE = new Set(['assignee', 'reporter', 'user', 'author', 'committer']);

/** Prune to allow-listed keys; pseudonymise logins, emails and people; sanitize free text that is kept. */
function sanitize(provider: 'github' | 'jira', value: unknown, parent = ''): unknown {
  const allowed = CASSETTE_KEYS[provider] as ReadonlySet<string>;
  if (Array.isArray(value)) return value.map((entry) => sanitize(provider, entry, parent));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (key === 'login' && typeof inner === 'string') out[key] = `author-${hash(inner)}`;
    else if (key === 'email' && typeof inner === 'string') out[key] = `author-${hash(inner)}@example.invalid`;
    else if ((key === 'message' || key === 'title') && typeof inner === 'string') out[key] = sanitizeMessage(inner);
    else if (provider === 'jira' && PEOPLE.has(parent) && typeof inner === 'string')
      out[key] = key === 'displayName' ? `Person ${hash(inner).slice(0, 6)} (pseudonymised)` : `user-${hash(inner)}`;
    else out[key] = sanitize(provider, inner, key);
  }
  return out;
}

function recorder(provider: 'github' | 'jira') {
  const interactions: CassetteInteraction[] = [];
  const seen = new Set<string>();
  const record: FetchLike = async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(input);
    const query = normalizeQuery(url.search);
    const id = `${init?.method ?? 'GET'} ${url.pathname}?${query}`;
    const text = await response.text();
    if (!seen.has(id)) {
      seen.add(id);
      const link = provider === 'github' ? response.headers.get('link') : null;
      interactions.push({
        request: { method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname, query },
        response: { status: response.status, headers: link ? { link } : {}, body: text ? sanitize(provider, JSON.parse(text)) : null },
      });
    }
    return new Response(text || null, { status: response.status, headers: response.headers });
  };
  return { record, interactions };
}

function save(file: string, provider: string, source: string, interactions: readonly CassetteInteraction[]) {
  const cassette: Cassette = { cassetteVersion: 1, provider, source, recordedAt: new Date().toISOString(), interactions };
  writeFileSync(new URL(file, OUT), `${JSON.stringify(cassette, null, 2)}\n`);
  process.stdout.write(`${file}: ${interactions.length} interactions\n`);
}

const scope = { organizationId: 'recorder', dealId: 'recorder', connectionId: 'recorder', credentialRef: null };

// GitHub: repository, two pages of commits and pull requests, reviews and checks for the first page.
const token = process.env['GITHUB_TOKEN'];
const auth: GitHubAuth = token ? { method: 'TOKEN', token: async () => token } : new AnonymousAuth();
const github = recorder('github');
const repo = new GitHubLiveAdapter({ repository: 'apache/kafka' }, () => auth, github.record);
await repo.validateConnection(scope);
await repo.head(scope);
const commits = await repo.listCommits(scope, { cursor: null, limit: 3 });
if (commits.nextCursor) await repo.listCommits(scope, { cursor: commits.nextCursor, limit: 3 });
const pulls = await repo.listPullRequests(scope, { cursor: null, limit: 3 });
if (pulls.nextCursor) await repo.listPullRequests(scope, { cursor: pulls.nextCursor, limit: 3 });
for (const pull of pulls.pullRequests) {
  await repo.pullRequestReviews(scope, pull.number);
  await repo.checkRuns(scope, pull.headSha);
}
save('github/apache__kafka.json', 'github', `https://api.github.com/repos/apache/kafka (public; ${token ? 'authenticated' : 'anonymous'}; recorded by packages/connectors/scripts/record-cassettes.ts for T-074): logins and emails pseudonymised, messages sanitized, bodies pruned to the allow-list`, github.interactions);

// Jira: the keys the recorded commits and pull requests name, plus two pages of the project.
const keys = [...new Set([...commits.commits.flatMap((commit) => issueKeysIn(commit.message)), ...pulls.pullRequests.flatMap((pull) => issueKeysIn(pull.title))])].filter((key) => key.startsWith('KAFKA-'));
const jira = recorder('jira');
const site = new JiraLiveAdapter({ site: 'issues.apache.org', basePath: '/jira', projectKeys: ['KAFKA'] }, { fetch: jira.record, policy: { selfHostedHosts: ['issues.apache.org'] } });
await site.validateConnection(scope);
const issues = await site.listIssues(scope, { cursor: null, limit: 3 });
if (issues.nextCursor) await site.listIssues(scope, { cursor: issues.nextCursor, limit: 3 });
await site.listSprints(scope).catch((error: unknown) => process.stdout.write(`sprints: ${(error as Error).message}\n`));
const linked = await site.issuesByKey(scope, keys);
process.stdout.write(`keys named by code: ${keys.join(', ') || '(none)'}; resolved: ${linked.map((issue) => issue.key).join(', ') || '(none)'}\n`);
save('jira/apache-kafka.json', 'jira', 'https://issues.apache.org/jira, project KAFKA (Jira Data Center, anonymous; recorded by packages/connectors/scripts/record-cassettes.ts for T-074): people pseudonymised, bodies pruned to the allow-list', jira.interactions);
