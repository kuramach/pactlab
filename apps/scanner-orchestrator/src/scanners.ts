import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { FindingSeverity, NormalizedScanFinding } from '@pactlab/domain';
import { z } from 'zod';

/**
 * One approved scanner behind a replaceable adapter. `run` returns the tool's
 * native output (untrusted); `normalize` keeps locations, hashes and versions
 * and drops everything else — native output may quote source, normalized
 * output never does.
 */
export interface ScannerAdapter {
  readonly name: string;
  readonly version: string;
  readonly rulesetVersion: string | null;
  run(dir: string, signal: AbortSignal): Promise<unknown>;
  normalize(native: unknown, commitSha: string): NormalizedScanFinding[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function listFiles(dir: string, signal: AbortSignal): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  signal.throwIfAborted();
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

// ---------------------------------------------------------------------------
// Static analysis: Semgrep JSON output shape, produced by a fixture rule set.

const semgrepOutputSchema = z.object({
  version: z.string(),
  results: z
    .array(
      z.object({
        check_id: z.string().min(1).max(200),
        path: z.string().min(1).max(500),
        start: z.object({ line: z.number().int().positive() }),
        end: z.object({ line: z.number().int().positive() }),
        extra: z.object({
          message: z.string().max(500),
          severity: z.enum(['ERROR', 'WARNING', 'INFO']),
          lines: z.string().optional(),
        }),
      }),
    )
    .max(1_000),
});

const SEMGREP_SEVERITY: Record<'ERROR' | 'WARNING' | 'INFO', FindingSeverity> = {
  ERROR: 'HIGH',
  WARNING: 'MEDIUM',
  INFO: 'LOW',
};

const FIXTURE_RULES = [
  {
    id: 'pactlab.fixture.no-dynamic-eval',
    pattern: /\beval\(/,
    message: 'Dynamic code evaluation of runtime input',
    severity: 'ERROR' as const,
    remediation: 'Replace eval with a constrained expression parser.',
  },
];

/**
 * Fixture scanner emitting Semgrep's JSON result shape from a fixed rule set,
 * so the live Semgrep adapter can replace it without changing normalization.
 */
export class SemgrepFixtureScanner implements ScannerAdapter {
  readonly name = 'semgrep';
  readonly version = '1.0.0-fixture';
  readonly rulesetVersion = 'pactlab-fixture-rules@1';

  async run(dir: string, signal: AbortSignal): Promise<unknown> {
    const results = [];
    for (const path of await listFiles(dir, signal)) {
      if (!path.endsWith('.ts')) continue;
      const lines = (await readFile(join(dir, path), 'utf8')).split('\n');
      signal.throwIfAborted();
      for (const [index, line] of lines.entries()) {
        for (const rule of FIXTURE_RULES) {
          if (!rule.pattern.test(line)) continue;
          results.push({
            check_id: rule.id,
            path,
            start: { line: index + 1, col: 1 },
            end: { line: index + 1, col: line.length + 1 },
            extra: { message: rule.message, severity: rule.severity, lines: line },
          });
        }
      }
    }
    return { version: this.version, results, errors: [] };
  }

  normalize(native: unknown, commitSha: string): NormalizedScanFinding[] {
    const output = semgrepOutputSchema.parse(native);
    return output.results.map((result) => {
      const rule = FIXTURE_RULES.find((candidate) => candidate.id === result.check_id);
      return {
        category: 'CODE',
        ruleId: result.check_id,
        title: result.extra.message,
        severity: SEMGREP_SEVERITY[result.extra.severity],
        confidence: 'HIGH',
        path: result.path,
        lineStart: result.start.line,
        lineEnd: result.end.line,
        // Hash of the matched text keeps the fingerprint stable as lines move.
        fingerprint: sha256(
          `${result.check_id}|${result.path}|${sha256(result.extra.lines ?? '')}`,
        ),
        scanner: this.name,
        scannerVersion: output.version,
        rulesetVersion: this.rulesetVersion,
        commitSha,
        remediation: rule?.remediation ?? null,
        license: null,
        component: null,
        cve: null,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// SBOM: CycloneDX JSON from the manifest, evaluated against a license policy.

const cycloneDxSchema = z.object({
  bomFormat: z.literal('CycloneDX'),
  specVersion: z.string(),
  components: z
    .array(
      z.object({
        type: z.string(),
        name: z.string().min(1).max(200),
        version: z.string().max(100),
        purl: z.string().max(500),
        licenses: z.array(z.object({ license: z.object({ id: z.string().max(100) }) })).optional(),
      }),
    )
    .max(10_000),
});

/** Synthetic package registry the fixture SBOM generator resolves licenses from. */
const FIXTURE_LICENSES: Readonly<Record<string, string>> = {
  'fixture-http': 'MIT',
  'fixture-ui': 'Apache-2.0',
  'fixture-agpl-ledger': 'AGPL-3.0-only',
};

const STRONG_COPYLEFT = /^(AGPL-|SSPL-)/;
const COPYLEFT = /^(GPL-|LGPL-|MPL-|EPL-)/;

const packageJsonSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional() });

export class CycloneDxFixtureSbom implements ScannerAdapter {
  readonly name = 'cyclonedx-sbom';
  readonly version = '1.5-fixture';
  readonly rulesetVersion = 'license-policy@1';

  async run(dir: string, signal: AbortSignal): Promise<unknown> {
    const manifest = packageJsonSchema.parse(
      JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')),
    );
    signal.throwIfAborted();
    return {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      version: 1,
      components: Object.entries(manifest.dependencies ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, version]) => ({
          type: 'library',
          name,
          version,
          purl: `pkg:npm/${name}@${version}`,
          ...(FIXTURE_LICENSES[name]
            ? { licenses: [{ license: { id: FIXTURE_LICENSES[name] } }] }
            : {}),
        })),
    };
  }

  normalize(native: unknown, commitSha: string): NormalizedScanFinding[] {
    const bom = cycloneDxSchema.parse(native);
    const findings: NormalizedScanFinding[] = [];
    for (const component of bom.components) {
      const license = component.licenses?.[0]?.license.id ?? null;
      const ruleId = !license
        ? 'license-unknown'
        : STRONG_COPYLEFT.test(license)
          ? 'license-strong-copyleft'
          : COPYLEFT.test(license)
            ? 'license-copyleft'
            : null;
      if (!ruleId) continue;
      findings.push({
        category: 'LICENSE',
        ruleId,
        title: license
          ? `${license} dependency ${component.name}`
          : `Dependency ${component.name} has no declared license`,
        severity:
          ruleId === 'license-strong-copyleft'
            ? 'HIGH'
            : ruleId === 'license-copyleft'
              ? 'MEDIUM'
              : 'LOW',
        confidence: license ? 'HIGH' : 'LOW',
        path: 'package.json',
        lineStart: null,
        lineEnd: null,
        fingerprint: sha256(`${ruleId}|${component.purl}`),
        scanner: this.name,
        scannerVersion: this.version,
        rulesetVersion: this.rulesetVersion,
        commitSha,
        remediation:
          ruleId === 'license-unknown'
            ? 'Confirm the license with the target before close.'
            : 'Confirm distribution model; replace the component or obtain a commercial license.',
        license,
        component: component.purl,
        cve: null,
      });
    }
    return findings;
  }
}
