import { publicEnv } from './env';

/** The release the services run (T-100), as the API's public /health reports it. */
export interface Release {
  readonly version: string | null;
  readonly sha: string;
}

/** "v2026.11.1 · build 9f36104", or "build 9f36104" for an untagged commit, or "local build". */
export function releaseLabel(release: Release | null): string {
  if (!release) return 'version unknown';
  const build = release.sha === 'local' ? 'local build' : `build ${release.sha.slice(0, 7)}`;
  return release.version ? `${release.version} · ${build}` : build;
}

/** Asked of the API at most once a minute; null when it does not answer. */
export async function currentRelease(): Promise<Release | null> {
  try {
    const response = await fetch(new URL('/health', publicEnv().NEXT_PUBLIC_API_ORIGIN), { next: { revalidate: 60 } });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown; sha?: unknown };
    return typeof body.sha === 'string' ? { version: typeof body.version === 'string' ? body.version : null, sha: body.sha } : null;
  } catch {
    return null;
  }
}
