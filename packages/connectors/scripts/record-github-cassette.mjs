#!/usr/bin/env node
// Operator-run: records a sanitized GitHub cassette from a small public
// repository (unauthenticated, read-only). Only fields the live adapter reads
// are kept; names, emails and logins become stable pseudonyms. Never point
// this at a private repository or pass a token.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const REPOSITORY = process.argv[2] ?? 'octocat/Hello-World';
const OUT = new URL(`../../../fixtures/cassettes/github/${REPOSITORY.replace('/', '__')}.json`, import.meta.url);
const API = 'https://api.github.com';
const VERSION = '2026-03-10';

const pseudonym = (value) =>
  value ? `author-${createHash('sha256').update(String(value).toLowerCase()).digest('hex').slice(0, 10)}` : null;

const person = (value) => (value ? { email: `${pseudonym(value.email)}@example.invalid`, date: value.date } : null);

const sanitizers = {
  repo: (body) => ({ full_name: body.full_name, default_branch: body.default_branch, visibility: body.visibility }),
  commit: (body) => ({
    sha: body.sha,
    commit: { author: person(body.commit?.author), committer: body.commit?.committer ? { date: body.commit.committer.date } : null },
    author: body.author ? { login: pseudonym(body.author.login) } : null,
    ...(body.stats ? { stats: { additions: body.stats.additions, deletions: body.stats.deletions, total: body.stats.total } } : {}),
    ...(body.files ? { files: body.files.map((file) => ({ filename: file.filename })) } : {}),
  }),
  error: (body) => ({ message: body?.message ?? null }),
};

const interactions = [];

async function record(path, query, kind) {
  const url = `${API}${path}${query ? `?${query}` : ''}`;
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': VERSION, 'user-agent': 'pactlab-cassette-recorder' },
  });
  const body = response.status === 204 ? null : await response.json();
  const clean =
    response.status >= 400
      ? sanitizers.error(body)
      : Array.isArray(body)
        ? body.map(sanitizers[kind])
        : sanitizers[kind](body);
  const link = response.headers.get('link');
  interactions.push({
    request: { method: 'GET', path, query: [...new URLSearchParams(query).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&') },
    response: { status: response.status, headers: link ? { link: link.replaceAll(API, 'https://api.github.com') } : {}, body: clean },
  });
  return clean;
}

const repo = await record(`/repos/${REPOSITORY}`, '', 'repo');
const head = await record(`/repos/${REPOSITORY}/commits`, `sha=${repo.default_branch}&per_page=100&page=1`, 'commit');
const shas = head.map((commit) => commit.sha);
// Dry runs read at most 50 commits per page.
await record(`/repos/${REPOSITORY}/commits`, `sha=${repo.default_branch}&per_page=50&page=1`, 'commit');
for (let page = 1; page <= Math.min(shas.length, 3); page += 1) {
  await record(`/repos/${REPOSITORY}/commits`, `sha=${repo.default_branch}&per_page=1&page=${page}`, 'commit');
}
await record(`/repos/${REPOSITORY}/commits`, `sha=${repo.default_branch}&per_page=1&page=${Math.min(shas.length, 3) + 1}`, 'commit');
for (const sha of shas.slice(0, 5)) await record(`/repos/${REPOSITORY}/commits/${sha}`, '', 'commit');
await record(`/repos/${REPOSITORY.split('/')[0]}/pactlab-does-not-exist`, '', 'repo');

await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify({ cassetteVersion: 1, provider: 'github', source: `${API}/repos/${REPOSITORY} (public, unauthenticated)`, recordedAt: new Date().toISOString(), interactions }, null, 2)}\n`,
);
process.stdout.write(`Recorded ${interactions.length} interactions to ${OUT.pathname}\n`);
