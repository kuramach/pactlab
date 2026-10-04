import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

export interface CheckoutTarget {
  readonly repository: string;
  readonly commitSha: string;
}

/**
 * Materializes one exact commit into a scan workspace. Live implementations
 * clone with a single-use, read-only token; nothing is retained afterwards.
 */
export interface SourceProvider {
  checkout(target: CheckoutTarget, dir: string, signal: AbortSignal): Promise<void>;
}

export class UnknownRepositoryError extends Error {
  constructor() {
    super('Repository is not available to this source provider');
    this.name = 'UnknownRepositoryError';
  }
}

/** Synthetic file trees. Content exists only inside a workspace while a scan runs. */
export const FIXTURE_SOURCES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'healthyco/platform': {
    'package.json': JSON.stringify({
      name: 'healthyco-platform',
      dependencies: { 'fixture-http': '4.1.0', 'fixture-ui': '2.0.0' },
    }),
    'api/server.ts': 'export function handler(input: string) {\n  return JSON.parse(input);\n}\n',
  },
  'troubledco/core': {
    'package.json': JSON.stringify({
      name: 'troubledco-core',
      dependencies: { 'fixture-http': '4.1.0', 'fixture-agpl-ledger': '2.1.0' },
    }),
    'billing/rules.ts':
      'export function applyRule(expression: string) {\n  // dynamic rule evaluation\n  return eval(expression);\n}\n',
  },
  'sparseco/app': {
    'package.json': JSON.stringify({
      name: 'sparseco-app',
      dependencies: { 'fixture-unknown': '0.0.1' },
    }),
    'app/index.ts': 'export const ready = true;\n',
  },
};

export class FixtureSourceProvider implements SourceProvider {
  async checkout(target: CheckoutTarget, dir: string, signal: AbortSignal): Promise<void> {
    const files = Object.hasOwn(FIXTURE_SOURCES, target.repository)
      ? FIXTURE_SOURCES[target.repository]
      : undefined;
    if (!files) throw new UnknownRepositoryError();
    for (const [path, content] of Object.entries(files)) {
      signal.throwIfAborted();
      const destination = join(dir, normalize(path));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, { mode: 0o600 });
    }
  }
}
