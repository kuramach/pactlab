import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Cassette } from './cassette';

const ROOT = new URL('../../../../fixtures/cassettes/', import.meta.url);

/** Keys a sanitized cassette may contain anywhere in a response body, per provider. */
const ALLOWED_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  github: new Set([
    'full_name', 'default_branch', 'visibility', 'sha', 'commit', 'author', 'committer', 'date', 'email', 'login',
    'stats', 'additions', 'deletions', 'total', 'files', 'filename', 'message',
    // Pull requests, reviews and check runs (T-082).
    'number', 'state', 'draft', 'title', 'user', 'created_at', 'closed_at', 'merged_at', 'head', 'base', 'ref',
    'total_count', 'check_runs', 'status', 'conclusion',
  ]),
  // Jira REST v2/v3 and Agile 1.0 shapes (T-082); hand-built, synthetic people only.
  jira: new Set([
    'deploymentType', 'id', 'name', 'schema', 'custom', 'statusCategory', 'key', 'errorMessages', 'accountId',
    'startAt', 'maxResults', 'total', 'issues', 'fields', 'issuetype', 'status', 'priority', 'created', 'resolutiondate',
    'assignee', 'reporter', 'displayName', 'comment', 'changelog', 'histories', 'items', 'field', 'from', 'to',
    'nextPageToken', 'isLast', 'values', 'type', 'state', 'boardId', 'startDate', 'endDate',
    'customfield_12310293', 'customfield_12310940', 'customfield_10016', 'customfield_10020',
  ]),
};

/** Every `login` anywhere in a body. */
function logins(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((entry) => logins(entry, found));
  else if (value && typeof value === 'object')
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'login' && typeof inner === 'string') found.push(inner);
      else logins(inner, found);
    }
  return found;
}

function keys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => keys(entry, found));
  else if (value && typeof value === 'object')
    for (const [key, inner] of Object.entries(value)) {
      found.add(key);
      keys(inner, found);
    }
  return found;
}

async function cassettes(): Promise<[string, Cassette][]> {
  const out: [string, Cassette][] = [];
  for (const provider of await readdir(ROOT, { withFileTypes: true })) {
    if (!provider.isDirectory()) continue;
    for (const file of await readdir(new URL(`${provider.name}/`, ROOT))) {
      if (file.endsWith('.json')) out.push([`${provider.name}/${file}`, JSON.parse(await readFile(new URL(`${provider.name}/${file}`, ROOT), 'utf8'))]);
    }
  }
  return out;
}

describe('recorded cassettes', () => {
  it('hold only allow-listed fields, pseudonymous identities and no credentials', async () => {
    const all = await cassettes();
    expect(all.length).toBeGreaterThan(0);
    for (const [name, cassette] of all) {
      const text = JSON.stringify(cassette);
      const allowed = ALLOWED_KEYS[cassette.provider];
      expect(allowed, `${name}: no allow-list for provider ${cassette.provider}`).toBeDefined();
      const unknown = [...keys(cassette.interactions.map((entry) => entry.response.body))].filter((key) => !allowed?.has(key));
      expect(unknown, name).toEqual([]);
      const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      expect(emails.filter((email) => !email.endsWith('@example.invalid')), name).toEqual([]);
      for (const entry of cassette.interactions) {
        for (const login of logins(entry.response.body)) expect(login, name).toMatch(/^author-[0-9a-f]{10}$/);
        expect(Object.keys(entry.response.headers).every((header) => header === 'link'), name).toBe(true);
      }
      expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|authorization|bearer /i);
    }
  });
});
