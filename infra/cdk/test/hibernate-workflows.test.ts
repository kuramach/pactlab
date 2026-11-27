import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The hibernate and wake workflows and scripts (ADR 0063): they never reach live, and never drop a restored snapshot. */
const root = resolve(import.meta.dirname, '../../..');
const workflow = (name: string) => readFileSync(join(root, '.github/workflows', name), 'utf8');
const script = (name: string) => join(root, 'scripts', name);
const options = (text: string, input: string) => {
  const block = text.slice(text.indexOf(`      ${input}:`));
  const match = /options: \[([^\]]*)\]/.exec(block);
  return match ? match[1]!.split(',').map((option) => option.trim()) : null;
};

describe('the power workflows never reach live (ADR 0063)', () => {
  it('offers only dev, qa and stage, from main, in each <env>-power GitHub Environment', () => {
    const power = workflow('env-power.yml');
    expect(options(power, 'environment')).toEqual(['dev', 'qa', 'stage']);
    expect(options(power, 'action')).toEqual(['hibernate', 'wake']);
    expect(power).toContain('environment: ${{ inputs.environment }}-power');
    expect(power).toContain('[ "$REF" = main ]');
    expect(power).toContain('role-to-assume: ${{ vars.AWS_POWER_ROLE_ARN }}');
    const idle = workflow('env-power-idle.yml');
    expect(/matrix:\s+environment: \[([^\]]*)\]/.exec(idle)![1]!.split(',').map((e) => e.trim())).toEqual(['dev', 'qa', 'stage']);
    expect(options(workflow('wake.yml'), 'environment')).toEqual(['dev', 'qa', 'stage']);
    for (const text of [power, idle]) expect(text).not.toMatch(/\b(live|prod)\b[^\n]*(options|matrix)/);
  });

  it('refuses live in every script, before touching AWS', () => {
    for (const name of ['hibernate-environment.sh', 'wake-hibernated.sh', 'env-hibernate.sh', 'env-wake.sh']) {
      for (const environment of ['live', 'prod']) {
        const run = spawnSync('bash', [script(name), environment], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
        expect(run.status, `${name} ${environment}`).not.toBe(0);
        expect(run.stderr, `${name} ${environment}`).toMatch(/Live (never hibernates|is always on)/);
      }
    }
  });

  it('refuses to deploy a hibernated environment', () => {
    expect(readFileSync(script('wake-environment.sh'), 'utf8')).toMatch(/hibernated \| hibernating \| rebuilding\)[\s\S]*Wake it first[\s\S]*exit 1/);
  });
});

describe('every deploy passes the shape and the restored snapshot (ADR 0063)', () => {
  /** power-context.sh against a fake `aws` that answers from a table. */
  const context = (env: string, parameters: Record<string, string>, extra: string[] = [], sleep = '') => {
    const bin = mkdtempSync(join(tmpdir(), 'power-context-'));
    writeFileSync(
      join(bin, 'aws'),
      `#!/usr/bin/env bash\nname=""; while [ $# -gt 0 ]; do [ "$1" = --name ] && name="$2"; shift; done\ncase "$name" in\n${Object.entries(parameters)
        .map(([name, value]) => `  '${name}') printf '%s\\n' '${value}' ;;`)
        .join('\n')}\n  *) echo "ParameterNotFound" >&2; exit 254 ;;\nesac\n`,
    );
    chmodSync(join(bin, 'aws'), 0o755);
    const run = spawnSync('bash', [script('power-context.sh'), env, ...extra], { encoding: 'utf8', env: { PATH: `${bin}:${process.env['PATH']}`, SLEEP_CERTIFICATE_ARN: sleep } });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout.trim();
  };

  it('names a restored snapshot on every awake deploy, so CloudFormation never replaces the database with an empty one', () => {
    expect(context('stage', { '/pactlab/stage/power': 'awake', '/pactlab/stage/database-source': 'pactlab-stage-hibernate-20261128t0300z' })).toBe(
      '-c pactlab:stage:power=awake -c pactlab:stage:databaseSource=pactlab-stage-hibernate-20261128t0300z',
    );
  });

  it('passes the shared neighbour too, with a hibernated one’s sleep certificate from its record', () => {
    const record = JSON.stringify({ snapshot: 'pactlab-qa-hibernate-x', sleepCertificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/qa' });
    expect(context('dev', { '/pactlab/dev/power': 'paused', '/pactlab/qa/power': 'hibernated', '/pactlab/qa/hibernation': record }, [], 'arn:aws:acm:us-east-1:111111111111:certificate/dev')).toBe(
      '-c pactlab:dev:power=awake -c pactlab:dev:sleepCertificateArn=arn:aws:acm:us-east-1:111111111111:certificate/dev -c pactlab:qa:power=hibernated -c pactlab:qa:sleepCertificateArn=arn:aws:acm:us-east-1:111111111111:certificate/qa',
    );
  });

  it('takes the shape being deployed as an override, and prints nothing for live', () => {
    expect(context('stage', { '/pactlab/stage/power': 'paused' }, ['stage=hibernated'])).toBe('-c pactlab:stage:power=hibernated');
    expect(context('live', {})).toBe('');
  });

  it('is used by deploy.yml, the hibernate and the wake', () => {
    expect(workflow('deploy.yml')).toContain('scripts/power-context.sh "$ENV_NAME"');
    expect(readFileSync(script('hibernate-environment.sh'), 'utf8')).toContain('scripts/power-context.sh "$ENV_NAME" "${ENV_NAME}=hibernated"');
    expect(readFileSync(script('wake-hibernated.sh'), 'utf8')).toContain('databaseSource=${SNAPSHOT}');
  });
});

describe('a hibernate stops before deleting anything when the snapshot fails (ADR 0063)', () => {
  const text = readFileSync(script('hibernate-environment.sh'), 'utf8');
  it('snapshots and verifies before the delete, and deletes only with a final snapshot', () => {
    const verify = text.indexOf('did not verify');
    const remove = text.indexOf('aws rds delete-db-instance');
    expect(verify).toBeGreaterThan(0);
    expect(remove).toBeGreaterThan(verify);
    expect(text.slice(remove, text.indexOf('\n', remove))).toContain('--final-db-snapshot-identifier');
    expect(text).toContain('Stopped before deleting anything');
  });

  it('writes a summary of what was deleted, what was kept and the snapshot id', () => {
    expect(text).toContain('### What changed');
    expect(text).toContain('Snapshots kept');
    expect(text).toContain('bin/hibernation.ts plan');
  });
});
