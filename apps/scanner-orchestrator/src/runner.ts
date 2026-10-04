import { createHash } from 'node:crypto';
import {
  SCAN_CATEGORIES,
  FINDING_CONFIDENCES,
  FINDING_SEVERITIES,
  type NormalizedScanFinding,
} from '@pactlab/domain';
import { z } from 'zod';
import type { ScannerAdapter } from './scanners';
import type { SourceProvider } from './source';
import { ScanCancelledError, ScanTimeoutError, withEphemeralWorkspace } from './workspace';

/**
 * What the control plane authorizes one scan to do. Carries no credentials;
 * live runners obtain a single-use read token for exactly this commit.
 */
export const scanManifestSchema = z.strictObject({
  scanId: z.uuid(),
  organizationId: z.uuid(),
  dealId: z.uuid(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
  commitSha: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/),
  tools: z.array(z.string().min(1).max(100)).min(1).max(10),
  expiresAt: z.iso.datetime(),
});
export type ScanManifest = z.infer<typeof scanManifestSchema>;

/** Result intake contract: strict, so any extra field (e.g. an excerpt) is rejected. */
const normalizedFindingSchema = z.strictObject({
  category: z.enum(SCAN_CATEGORIES),
  ruleId: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  severity: z.enum(FINDING_SEVERITIES),
  confidence: z.enum(FINDING_CONFIDENCES),
  path: z.string().max(500).nullable(),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  scanner: z.string().min(1).max(100),
  scannerVersion: z.string().min(1).max(100),
  rulesetVersion: z.string().max(100).nullable(),
  commitSha: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/),
  remediation: z.string().max(1_000).nullable(),
  license: z.string().max(100).nullable(),
  component: z.string().max(500).nullable(),
  cve: z.string().max(50).nullable(),
});

export const MAX_FINDINGS_PER_TOOL = 500;

export interface ToolRun {
  readonly name: string;
  readonly version: string;
  readonly rulesetVersion: string | null;
  /** Checksum of the native output; the output itself is discarded with the workspace. */
  readonly outputSha256: string;
  readonly findings: number;
}

export type ScanRunResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly scanId: string;
      readonly repository: string;
      readonly commitSha: string;
      readonly tools: readonly ToolRun[];
      readonly findings: readonly NormalizedScanFinding[];
    }
  | {
      readonly status: 'REJECTED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';
      readonly scanId: string | null;
      readonly reason: string;
    };

export interface ScanRunnerDeps {
  readonly source: SourceProvider;
  /** Approved scanners by name; a manifest naming anything else is rejected. */
  readonly scanners: readonly ScannerAdapter[];
  readonly timeoutMs: number;
  readonly workspaceRoot?: string;
  readonly now?: () => Date;
}

async function runTool(
  manifest: ScanManifest,
  scanner: ScannerAdapter,
  deps: ScanRunnerDeps,
  signal: AbortSignal,
): Promise<{ tool: ToolRun; findings: NormalizedScanFinding[] }> {
  return withEphemeralWorkspace(
    {
      timeoutMs: deps.timeoutMs,
      signal,
      ...(deps.workspaceRoot ? { root: deps.workspaceRoot } : {}),
    },
    async (dir, inner) => {
      await deps.source.checkout(manifest, dir, inner);
      const native = await scanner.run(dir, inner);
      const findings = z
        .array(normalizedFindingSchema)
        .max(MAX_FINDINGS_PER_TOOL)
        .parse(scanner.normalize(native, manifest.commitSha));
      if (findings.some((finding) => finding.commitSha !== manifest.commitSha))
        throw new Error('Scanner reported a different commit');
      return {
        tool: {
          name: scanner.name,
          version: scanner.version,
          rulesetVersion: scanner.rulesetVersion,
          outputSha256: createHash('sha256').update(JSON.stringify(native)).digest('hex'),
          findings: findings.length,
        },
        findings,
      };
    },
  );
}

/**
 * Fan one manifest out to an isolated runner per approved tool. Each runner
 * checks out the exact commit into its own workspace, which is destroyed
 * before this returns, whatever the outcome. Only normalized findings,
 * versions and checksums leave.
 */
export async function runScan(
  input: unknown,
  deps: ScanRunnerDeps,
  signal?: AbortSignal,
): Promise<ScanRunResult> {
  const parsed = scanManifestSchema.safeParse(input);
  if (!parsed.success) return { status: 'REJECTED', scanId: null, reason: 'Invalid scan manifest' };
  const manifest = parsed.data;
  const now = deps.now?.() ?? new Date();
  if (Date.parse(manifest.expiresAt) <= now.getTime())
    return { status: 'REJECTED', scanId: manifest.scanId, reason: 'Scan manifest has expired' };
  const scanners = manifest.tools.flatMap((name) => deps.scanners.filter((s) => s.name === name));
  if (scanners.length !== manifest.tools.length)
    return {
      status: 'REJECTED',
      scanId: manifest.scanId,
      reason: 'Manifest names an unapproved tool',
    };

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const settled = await Promise.allSettled(
    scanners.map((scanner) =>
      runTool(manifest, scanner, deps, controller.signal).catch((error: unknown) => {
        controller.abort();
        throw error;
      }),
    ),
  );
  signal?.removeEventListener('abort', abort);

  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure) {
    const errors = settled.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : [],
    );
    if (errors.some((error) => error instanceof ScanTimeoutError))
      return {
        status: 'TIMED_OUT',
        scanId: manifest.scanId,
        reason: 'Scan exceeded its time limit',
      };
    if (signal?.aborted || errors.every((error) => error instanceof ScanCancelledError))
      return { status: 'CANCELLED', scanId: manifest.scanId, reason: 'Scan was cancelled' };
    return { status: 'FAILED', scanId: manifest.scanId, reason: 'A scanner failed' };
  }
  const runs = settled.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  );
  return {
    status: 'SUCCEEDED',
    scanId: manifest.scanId,
    repository: manifest.repository,
    commitSha: manifest.commitSha,
    tools: runs.map((run) => run.tool),
    findings: runs.flatMap((run) => run.findings),
  };
}
