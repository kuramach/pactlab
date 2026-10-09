import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Cassette } from './cassette';

const ROOT = new URL('../../../../fixtures/cassettes/', import.meta.url);

/** Keys a sanitized GitHub cassette may contain anywhere in a response body. */
const ALLOWED_KEYS = new Set([
  'full_name', 'default_branch', 'visibility', 'sha', 'commit', 'author', 'committer', 'date', 'email', 'login',
  'stats', 'additions', 'deletions', 'total', 'files', 'filename', 'message',
]);

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
      const unknown = [...keys(cassette.interactions.map((entry) => entry.response.body))].filter((key) => !ALLOWED_KEYS.has(key));
      expect(unknown, name).toEqual([]);
      const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      expect(emails.filter((email) => !email.endsWith('@example.invalid')), name).toEqual([]);
      for (const entry of cassette.interactions) {
        const login = (entry.response.body as { author?: { login?: string } } | null)?.author?.login;
        if (login) expect(login).toMatch(/^author-[0-9a-f]{10}$/);
        expect(Object.keys(entry.response.headers).every((header) => header === 'link'), name).toBe(true);
      }
      expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|authorization|bearer /i);
    }
  });
});
