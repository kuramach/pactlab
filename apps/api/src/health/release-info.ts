import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/** The release the services run: its tag (null when untagged) and commit. */
export interface Release {
  readonly version: string | null;
  readonly sha: string;
}

export interface ReleaseSource {
  /** The parameter's JSON value, or null if it cannot be read. */
  read(): Promise<string | null>;
}

const REFRESH_MS = 5 * 60_000;

/** Reads the environment's release parameter (written by each deploy, T-100). */
export function ssmReleaseSource(parameterName: string, region?: string): ReleaseSource {
  const client = new SSMClient(region ? { region } : {});
  return {
    async read() {
      try {
        const result = await client.send(new GetParameterCommand({ Name: parameterName }));
        return result.Parameter?.Value ?? null;
      } catch {
        return null;
      }
    },
  };
}

function parse(value: string | null): Release | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; sha?: unknown };
    if (typeof parsed.sha !== 'string' || parsed.sha === '') return null;
    return { version: typeof parsed.version === 'string' && /^v\d{4}\.\d{2}\.\d+$/.test(parsed.version) ? parsed.version : null, sha: parsed.sha };
  } catch {
    return null;
  }
}

/**
 * What /health and the app's version line report. Deployed: the release parameter, refreshed every
 * five minutes, keeping the last good value if a read fails (a health check never fails on it).
 * Locally: APP_VERSION if set, else the commit is "local".
 */
export class ReleaseInfo {
  private current: Release;
  private loadedAt = Number.NEGATIVE_INFINITY;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly source: ReleaseSource | null,
    fallback: Release = { version: process.env['APP_VERSION'] ?? null, sha: 'local' },
    private readonly now: () => number = Date.now,
  ) {
    this.current = fallback;
  }

  async get(): Promise<Release> {
    if (this.source && this.now() - this.loadedAt >= REFRESH_MS) {
      this.loading ??= this.source
        .read()
        .then((value) => {
          const release = parse(value);
          if (release) this.current = release;
          this.loadedAt = this.now();
        })
        .finally(() => {
          this.loading = null;
        });
      await this.loading;
    }
    return this.current;
  }
}
