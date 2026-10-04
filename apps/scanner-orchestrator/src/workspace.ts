import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class ScanTimeoutError extends Error {
  constructor() {
    super('Scan exceeded its time limit');
    this.name = 'ScanTimeoutError';
  }
}

export class ScanCancelledError extends Error {
  constructor() {
    super('Scan was cancelled');
    this.name = 'ScanCancelledError';
  }
}

export class WorkspaceCleanupError extends Error {
  constructor() {
    super('Scan workspace could not be destroyed');
    this.name = 'WorkspaceCleanupError';
  }
}

export interface WorkspaceOptions {
  /** Parent directory for workspaces; defaults to the OS temp dir. */
  readonly root?: string;
  readonly timeoutMs: number;
  /** External cancellation. */
  readonly signal?: AbortSignal;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `work` inside a fresh private directory and destroy it on every exit
 * path: success, failure, timeout and cancellation. Destruction is verified;
 * a workspace that survives is an error, never a warning.
 */
export async function withEphemeralWorkspace<T>(
  options: WorkspaceOptions,
  work: (dir: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(options.root ?? tmpdir(), 'pactlab-scan-'));
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let cancel = () => {};
  const stop = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new ScanCancelledError());
    };
    timer = setTimeout(() => {
      controller.abort();
      reject(new ScanTimeoutError());
    }, options.timeoutMs);
  });
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener('abort', cancel, { once: true });
  // A scanner still running after timeout or cancellation must not surface later.
  const running = Promise.resolve().then(() => work(dir, controller.signal));
  running.catch(() => {});
  stop.catch(() => {});
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await Promise.race([running, stop]) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  clearTimeout(timer);
  options.signal?.removeEventListener('abort', cancel);
  controller.abort();
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  if (await exists(dir)) throw new WorkspaceCleanupError();
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
