import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * AI steps on the seller's machine (T-178): classification into the pack's taxonomy and, for scans, the
 * vision lane. They run only under a signed-in Pactlab preparer account, through the AI gateway, as
 * metered jobs under the ADR 0034 gates; anonymous AI access is never offered. Offline, the jobs queue on
 * disk and run on reconnect. Results are cached by the file's SHA-256, so re-rinsing costs nothing.
 */
export type AiJob =
  | { readonly kind: 'CLASSIFY'; readonly sha256: string; readonly fileName: string; readonly pageTexts: readonly string[]; readonly categories: readonly string[] }
  | { readonly kind: 'VISION'; readonly sha256: string; readonly fileName: string; readonly pages: number };

export interface Classification {
  readonly category: string;
  readonly confidence: number;
  readonly promptVersion: string;
}

/** The AI gateway, as the desktop reaches it. Every call carries the preparer's session. */
export interface RinseAiClient {
  classify(job: Extract<AiJob, { kind: 'CLASSIFY' }>): Promise<Classification>;
  /** The vision lane's transcription of each page of a scan, read from the original's images. */
  readPages(job: Extract<AiJob, { kind: 'VISION' }>, image: (page: number) => Promise<Uint8Array>): Promise<string[]>;
}

export interface AiCacheEntry {
  classification?: Classification;
  vision?: string[];
}

interface QueueFile {
  readonly jobs: AiJob[];
  readonly cache: Record<string, AiCacheEntry>;
}

const key = (job: AiJob) => `${job.kind}:${job.sha256}`;

/** A durable queue and result cache in the app's data folder; written atomically (temp file, then rename). */
export class AiQueue {
  private jobs: AiJob[] = [];
  private cache: Record<string, AiCacheEntry> = {};

  private constructor(private readonly path: string | null) {}

  static memory(): AiQueue {
    return new AiQueue(null);
  }

  static async open(path: string): Promise<AiQueue> {
    const queue = new AiQueue(path);
    try {
      const stored = JSON.parse(await readFile(path, 'utf8')) as QueueFile;
      queue.jobs = stored.jobs ?? [];
      queue.cache = stored.cache ?? {};
    } catch {
      // A first run, or an unreadable file: start empty (the cache only saves calls).
    }
    return queue;
  }

  private async save(): Promise<void> {
    if (!this.path) return;
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify({ jobs: this.jobs, cache: this.cache } satisfies QueueFile));
    await rename(temporary, this.path);
  }

  cached(sha256: string): AiCacheEntry {
    return this.cache[sha256] ?? {};
  }

  pending(): readonly AiJob[] {
    return this.jobs;
  }

  /** Queue a job once; a job whose result is already cached is not queued. */
  async enqueue(job: AiJob): Promise<void> {
    const entry = this.cache[job.sha256];
    if ((job.kind === 'CLASSIFY' && entry?.classification) || (job.kind === 'VISION' && entry?.vision)) return;
    if (this.jobs.some((queued) => key(queued) === key(job))) return;
    this.jobs.push(job);
    await this.save();
  }

  /**
   * Run every queued job. A job that fails stays queued (offline, signed out, the gateway down) and the
   * rest still run; nothing is dropped. Returns how many ran and how many wait.
   */
  async drain(client: RinseAiClient, image: (sha256: string, page: number) => Promise<Uint8Array>): Promise<{ ran: number; waiting: number }> {
    let ran = 0;
    const left: AiJob[] = [];
    for (const job of this.jobs) {
      try {
        const entry = (this.cache[job.sha256] ??= {});
        if (job.kind === 'CLASSIFY') entry.classification = await client.classify(job);
        else entry.vision = await client.readPages(job, (page) => image(job.sha256, page));
        ran += 1;
      } catch {
        left.push(job);
      }
    }
    this.jobs = left;
    await this.save();
    return { ran, waiting: left.length };
  }
}

/** A client that is never reachable: the app before sign-in, or with the network off. */
export const OFFLINE_AI: RinseAiClient = {
  classify: () => Promise.reject(new Error('Offline')),
  readPages: () => Promise.reject(new Error('Offline')),
};
