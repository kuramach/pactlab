import { readFile } from 'node:fs/promises';
import type { Cassette } from '../http/cassette';
import type { GitHubAuth } from './auth';

/** Sanitized recording of the public octocat/Hello-World repository. */
export async function helloWorld(): Promise<Cassette> {
  const url = new URL('../../../../fixtures/cassettes/github/octocat__Hello-World.json', import.meta.url);
  return JSON.parse(await readFile(url, 'utf8')) as Cassette;
}

/** A credential that is always available; the cassette does not check it. */
export const STATIC_AUTH: GitHubAuth = { method: 'TOKEN', token: async () => 'test-token' };
