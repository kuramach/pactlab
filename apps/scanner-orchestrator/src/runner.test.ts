import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubFixtureAdapter } from '@pactlab/connectors';
import { createDraft, newId, scanFindingToProposal } from '@pactlab/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScan, type ScanRunnerDeps } from './runner';
import { CycloneDxFixtureSbom, SemgrepFixtureScanner, type ScannerAdapter } from './scanners';
import { FixtureSourceProvider } from './source';

const NOW = new Date('2026-10-04T12:00:00Z');

async function headOf(repository: string) {
  const adapter = new GitHubFixtureAdapter({ repository });
  return (
    await adapter.head({
      organizationId: newId(),
      dealId: newId(),
      connectionId: newId(),
      credentialRef: null,
    })
  ).headSha;
}

const manifest = async (overrides: Record<string, unknown> = {}) => ({
  scanId: newId(),
  organizationId: newId(),
  dealId: newId(),
  repository: 'troubledco/core',
  commitSha: await headOf('troubledco/core'),
  tools: ['semgrep', 'cyclonedx-sbom'],
  expiresAt: '2026-10-04T13:00:00Z',
  ...overrides,
});

/** Records the workspace it ran in, then behaves as configured. */
class ProbeScanner implements ScannerAdapter {
  readonly version = '0.0.1';
  readonly rulesetVersion = null;
  dirs: string[] = [];
  constructor(
    readonly name: string,
    private readonly behaviour: 'ok' | 'throw' | 'hang' | 'excerpt',
  ) {}
  async run(dir: string, signal: AbortSignal) {
    this.dirs.push(dir);
    await access(join(dir, 'package.json'));
    if (this.behaviour === 'throw') throw new Error('scanner crashed');
    if (this.behaviour === 'hang')
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    return {};
  }
  normalize(_native: unknown, commitSha: string) {
    if (this.behaviour !== 'excerpt') return [];
    return [
      {
        ...new SemgrepFixtureScanner().normalize(
          {
            version: '1',
            results: [
              {
                check_id: 'x',
                path: 'a.ts',
                start: { line: 1 },
                end: { line: 1 },
                extra: { message: 'm', severity: 'INFO', lines: 'secret code' },
              },
            ],
          },
          commitSha,
        )[0]!,
        excerpt: 'secret code',
      },
    ];
  }
}

describe('ephemeral scan runner', () => {
  let root: string;
  let deps: (scanners?: ScannerAdapter[], timeoutMs?: number) => ScanRunnerDeps;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pactlab-scan-test-'));
    deps = (
      scanners = [new SemgrepFixtureScanner(), new CycloneDxFixtureSbom()],
      timeoutMs = 5_000,
    ) => ({
      source: new FixtureSourceProvider(),
      scanners,
      timeoutMs,
      workspaceRoot: root,
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function expectNoWorkspaceLeft(probe?: ProbeScanner) {
    expect(await readdir(root)).toEqual([]);
    for (const dir of probe?.dirs ?? []) await expect(access(dir)).rejects.toThrow();
  }

  it('returns normalized findings with commit and tool versions, and no source survives', async () => {
    const input = await manifest();
    const result = await runScan(input, deps());
    expect(result.status).toBe('SUCCEEDED');
    if (result.status !== 'SUCCEEDED') return;
    expect(result.commitSha).toBe(input.commitSha);
    expect(result.tools.map((tool) => [tool.name, tool.version, tool.findings])).toEqual([
      ['semgrep', '1.0.0-fixture', 1],
      ['cyclonedx-sbom', '1.5-fixture', 1],
    ]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      'pactlab.fixture.no-dynamic-eval',
      'license-strong-copyleft',
    ]);
    expect(result.findings[1]).toMatchObject({
      license: 'AGPL-3.0-only',
      component: 'pkg:npm/fixture-agpl-ledger@2.1.0',
      commitSha: input.commitSha,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('eval(expression)');
    expect(serialized).not.toContain('dynamic rule evaluation');
    await expectNoWorkspaceLeft();

    const evidenceItemId = newId();
    const draft = createDraft(
      scanFindingToProposal(result.findings[1]!, evidenceItemId),
      { kind: 'SYSTEM', component: 'scanner' },
      {
        id: newId(),
        organizationId: input.organizationId,
        dealId: input.dealId,
        now: NOW.toISOString(),
      },
    );
    expect(draft).toMatchObject({ status: 'DRAFT', domain: 'OSS_LICENSE' });
    expect(draft.evidence[0]).toMatchObject({
      evidenceItemId,
      commitSha: input.commitSha,
      toolName: 'cyclonedx-sbom',
      toolVersion: '1.5-fixture',
    });
  });

  it('is deterministic: re-running the same commit yields identical fingerprints', async () => {
    const input = await manifest();
    const first = await runScan(input, deps());
    const second = await runScan({ ...input, scanId: newId() }, deps());
    if (first.status !== 'SUCCEEDED' || second.status !== 'SUCCEEDED')
      throw new Error('scan failed');
    expect(second.findings).toEqual(first.findings);
  });

  it('HealthyCo scans clean', async () => {
    const result = await runScan(
      await manifest({
        repository: 'healthyco/platform',
        commitSha: await headOf('healthyco/platform'),
      }),
      deps(),
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', findings: [] });
  });

  it('destroys every workspace when a scanner fails', async () => {
    const crash = new ProbeScanner('crash', 'throw');
    const hang = new ProbeScanner('hang', 'hang');
    const result = await runScan(await manifest({ tools: ['crash', 'hang'] }), deps([crash, hang]));
    expect(result).toMatchObject({ status: 'FAILED', reason: 'A scanner failed' });
    expect(crash.dirs).toHaveLength(1);
    await expectNoWorkspaceLeft(crash);
    await expectNoWorkspaceLeft(hang);
  });

  it('destroys the workspace when a scan times out', async () => {
    const hang = new ProbeScanner('hang', 'hang');
    const result = await runScan(await manifest({ tools: ['hang'] }), deps([hang], 50));
    expect(result.status).toBe('TIMED_OUT');
    expect(hang.dirs).toHaveLength(1);
    await expectNoWorkspaceLeft(hang);
  });

  it('destroys the workspace when a scan is cancelled', async () => {
    const hang = new ProbeScanner('hang', 'hang');
    const controller = new AbortController();
    const running = runScan(await manifest({ tools: ['hang'] }), deps([hang]), controller.signal);
    setTimeout(() => controller.abort(), 20);
    expect((await running).status).toBe('CANCELLED');
    await expectNoWorkspaceLeft(hang);
  });

  it('rejects normalized output that carries source excerpts', async () => {
    const leaky = new ProbeScanner('leaky', 'excerpt');
    const result = await runScan(await manifest({ tools: ['leaky'] }), deps([leaky]));
    expect(result.status).toBe('FAILED');
    expect(JSON.stringify(result)).not.toContain('secret code');
    await expectNoWorkspaceLeft(leaky);
  });

  it('rejects expired, malformed, credential-bearing and unapproved manifests before any checkout', async () => {
    expect(
      (await runScan(await manifest({ expiresAt: '2026-10-04T11:00:00Z' }), deps())).status,
    ).toBe('REJECTED');
    expect((await runScan(await manifest({ commitSha: 'main' }), deps())).status).toBe('REJECTED');
    expect((await runScan(await manifest({ token: 'ghs_x' }), deps())).status).toBe('REJECTED');
    expect((await runScan(await manifest({ tools: ['trufflehog'] }), deps())).status).toBe(
      'REJECTED',
    );
    await expectNoWorkspaceLeft();
  });

  it('fails an unknown repository without leaving a workspace', async () => {
    const result = await runScan(await manifest({ repository: 'nobody/nothing' }), deps());
    expect(result.status).toBe('FAILED');
    await expectNoWorkspaceLeft();
  });
});
