import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Run the app as `cdk` does (CDK_OUTDIR set): the manifest must list every environment's stack. A scratch `App`
 * created while building a stack auto-synthesizes on exit and overwrote it once, leaving only PactlabProd, so the
 * site workflow found no PactlabSite (2026-11-28).
 */
describe('the CDK app manifest', () => {
  it('lists every environment, not only the last one built', () => {
    const outdir = mkdtempSync(join(tmpdir(), 'pactlab-cdk-'));
    const run = spawnSync('npx', ['tsx', resolve(import.meta.dirname, '../bin/pactlab.ts')], { env: { ...process.env, CDK_OUTDIR: outdir }, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf8')) as { artifacts: Record<string, { type: string }> };
    const stacks = Object.entries(manifest.artifacts).filter(([, artifact]) => artifact.type === 'aws:cloudformation:stack').map(([id]) => id);
    expect(stacks).toEqual(expect.arrayContaining(['PactlabNonliveBase', 'PactlabDev', 'PactlabQa', 'PactlabStage', 'PactlabProd', 'PactlabDeployAccess']));
  }, 300_000);
});
