import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { devConfig, ENVIRONMENT_NAMES, ENVIRONMENTS, qaConfig, stageConfig, type EnvironmentConfig } from '../config';
import { triageEnvironments } from '../lib/log-triage';
import { platformStack } from './helpers';

// Pre-production log triage (T-157): T-150's pipeline, parameterized by environment.
const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any -- the handler and the script are plain CommonJS */
const triage = require('../lambda/log-triage/triage.js') as any;
const { makeRun } = require('../lambda/log-triage/index.js') as any;
const task = require('../../../scripts/triage-to-task.cjs') as any;

const row = (fields: Record<string, string>) => Object.entries(fields).map(([field, value]) => ({ field, value }));
const errorRow = (id: string, message = 'boom', service = 'api') =>
  row({
    '@ptr': id,
    '@timestamp': '2026-11-25 10:00:00.000',
    '@logStream': `${service}/${service}/1`,
    '@message': JSON.stringify({ level: 50, service, message: 'unhandled', err: { type: 'TypeError', message, stack: `TypeError: ${message}\n    at A.run (/repo/apps/api/src/a.ts:3:1)` } }),
  });

describe('environment configuration resolution', () => {
  it('resolves the dev account to dev and qa, stage to itself, and live to T-150’s own shape', () => {
    expect(triageEnvironments(devConfig)).toEqual([
      { name: 'dev', logGroupName: '/pactlab/dev/app', cluster: 'pactlab-dev', own: true },
      { name: 'qa', logGroupName: '/pactlab/qa/app', cluster: 'pactlab-qa', own: false },
    ]);
    expect(triageEnvironments(stageConfig)).toEqual([{ name: 'stage', logGroupName: '/pactlab/stage/app', cluster: 'pactlab-stage', own: true }]);
    expect(triageEnvironments(ENVIRONMENTS.prod)).toBeUndefined();
  });

  it('sweeps every pre-production environment with an app exactly once', () => {
    const swept = ENVIRONMENT_NAMES.flatMap((name) => triageEnvironments(ENVIRONMENTS[name])?.map((e) => e.name) ?? []);
    const preProduction = ENVIRONMENT_NAMES.filter((name) => name !== 'prod' && ENVIRONMENTS[name].service);
    expect([...swept].sort()).toEqual([...preProduction].sort());
  });

  it('refuses a deployment that would sweep live, another account, or an environment with its own', () => {
    const triageOf = (config: EnvironmentConfig, environments: readonly string[]) =>
      ({ ...config, logTriage: { ...config.logTriage!, environments } }) as EnvironmentConfig;
    expect(() => triageEnvironments(triageOf(devConfig, ['dev', 'prod']))).toThrow(/never sweeps/);
    expect(() => triageEnvironments(triageOf(stageConfig, ['stage', 'qa']))).toThrow(/not in stage's account/);
    expect(() => triageEnvironments(triageOf(devConfig, ['qa']))).toThrow(/sweep dev itself/);
    expect(() => triageEnvironments(triageOf(qaConfig, ['qa', 'dev']))).toThrow(/own log triage/);
  });

  it('reads the same environments back in the Lambda, with separate state and labels per environment', () => {
    const envs = triage.environmentsFrom({ TRIAGE_ENVIRONMENTS: JSON.stringify([{ name: 'dev', logGroups: ['/pactlab/dev/app'] }, { name: 'qa', logGroups: ['/pactlab/qa/app'], cluster: 'pactlab-qa' }]) });
    expect(envs.map((e: any) => [e.profile.name, e.profile.statePrefix, e.profile.labels, e.logGroupPrefix])).toEqual([
      ['dev', 'dev#', ['env-triage', 'env:dev'], '/pactlab/dev/'],
      ['qa', 'qa#', ['env-triage', 'env:qa'], '/pactlab/qa/'],
    ]);
    // Live, configured as T-150 built it.
    const [liveEnv] = triage.environmentsFrom({ LOG_GROUPS: '["/pactlab/prod/app"]', LOG_GROUP_PREFIX: '/pactlab/prod/', CLUSTER: 'c', SERVICES: '["s"]' });
    expect(liveEnv.profile).toMatchObject({ scope: 'live', statePrefix: '', labels: ['live-triage'] });
    expect(() => triage.environmentsFrom({ TRIAGE_ENVIRONMENTS: JSON.stringify([{ name: 'Dev; rm', logGroups: ['x'] }]) })).toThrow(/Not an environment name/);
    expect(() => triage.environmentsFrom({ TRIAGE_ENVIRONMENTS: JSON.stringify([{ name: 'qa', logGroups: ['x'] }, { name: 'qa', logGroups: ['y'] }]) })).toThrow(/twice/);
  });
});

describe('per-environment dedupe markers', () => {
  const sig = '0123456789abcdef';
  const dev = triage.envProfile('dev');
  const qa = triage.envProfile('qa');

  it('carries the environment, so the same signature in dev, qa and live stays separate issues', () => {
    const devBody = `x\n${triage.marker(sig, dev)}`;
    const liveBody = `x\n${triage.marker(sig)}`;
    expect(triage.marker(sig, dev)).toBe(`<!-- env-triage-signature: dev ${sig} -->`);
    expect(triage.signatureFromBody(devBody, dev)).toBe(sig);
    expect(triage.signatureFromBody(devBody, qa)).toBeNull();
    expect(triage.signatureFromBody(devBody, triage.LIVE)).toBeNull();
    expect(triage.signatureFromBody(liveBody, dev)).toBeNull();
    expect(triage.signatureFromBody(liveBody, triage.LIVE)).toBe(sig);
  });

  it('titles and labels issues with the environment', () => {
    const item = { headline: 'Deal lookup throws' };
    expect(triage.issueTitle(item, dev)).toBe('[env-triage:dev] Deal lookup throws');
    expect(triage.issueTitle(item)).toBe('[live-triage] Deal lookup throws');
    expect(dev.labels).toEqual(['env-triage', 'env:dev']);
  });
});

/** A whole pre-production run against fakes; rows are per log group, then per query kind. */
function harness(options: { environments: { name: string; group: string }[]; modelId?: string; dryRun?: boolean; rows?: Record<string, Record<string, unknown[]>>; open?: Record<string, { number: number; html_url: string; body: string }[]> }) {
  const calls = { emails: [] as any[], created: [] as any[], comments: [] as any[], states: [] as any[], watermarks: [] as [number, string][], logs: [] as any[], converse: 0, openLabels: [] as string[][] };
  const now = Date.parse('2026-11-25T13:00:00Z');
  const queries: { groups: string[]; kind: string }[] = [];
  const deps = {
    now: () => now,
    sleep: async () => {},
    log: (entry: unknown) => calls.logs.push(entry),
    logs: {
      listLogGroups: async (prefix: string) => options.environments.map((e) => e.group).filter((g) => g.startsWith(prefix)),
      startQuery: async (input: any) => {
        const kind = triage.QUERIES.find((q: any) => q.query === input.queryString).kind;
        queries.push({ groups: input.logGroupNames, kind });
        return String(queries.length - 1);
      },
      getQueryResults: async (id: string) => {
        const q = queries[Number(id)]!;
        return { status: 'Complete', results: q.groups.flatMap((g) => options.rows?.[g]?.[q.kind] ?? []) };
      },
    },
    state: {
      getWatermark: async () => null,
      putWatermark: async (at: number, prefix: string) => calls.watermarks.push([at, prefix]),
      getStates: async () => ({}),
      putStates: async (items: unknown[]) => calls.states.push(...items),
    },
    bedrock: {
      converse: async () => {
        calls.converse += 1;
        return { output: { message: { content: [{ toolUse: { name: 'record_verdict', input: { verdict: 'likely_bug', headline: 'Deal lookup throws', summary: 'It throws.', fix_sketch: 'Guard it.' } } }] } } };
      },
    },
    ecs: { recentDeploys: async () => [] },
    ses: { send: async (digest: unknown) => void calls.emails.push(digest) },
    github: {
      token: async () => 'github_pat_x',
      openIssues: async (_token: string, labels: string[]) => {
        calls.openLabels.push(labels);
        return options.open?.[labels[1]!] ?? [];
      },
      createIssue: async (_token: string, issue: any) => {
        calls.created.push(issue);
        return { number: 200 + calls.created.length, html_url: `https://github.com/kuramach/pactlab/issues/${200 + calls.created.length}` };
      },
      comment: async (_token: string, number: number, body: string) => calls.comments.push({ number, body }),
    },
  };
  const env = {
    TRIAGE_ENVIRONMENTS: JSON.stringify(options.environments.map((e) => ({ name: e.name, logGroups: [e.group], logGroupPrefix: `/pactlab/${e.name}/` }))),
    ACCOUNT_LABEL: `${options.environments[0]!.name} account`,
    MODEL_ID: options.modelId ?? '',
    RECIPIENT: 'kumar@pactlab.ai',
    DRY_RUN: String(Boolean(options.dryRun)),
    MAX_CLUSTERS: '10',
  };
  return { run: makeRun(deps, env), calls, queries, now };
}
const devAccount = [
  { name: 'dev', group: '/pactlab/dev/app' },
  { name: 'qa', group: '/pactlab/qa/app' },
];

describe('the dev account, cluster-only (no Bedrock)', () => {
  it('queries each environment’s own log group, calls no model, and shows every verdict as unclassified', async () => {
    const { run, calls, queries } = harness({ environments: devAccount, rows: { '/pactlab/dev/app': { error: [errorRow('d1', 'dev only')] }, '/pactlab/qa/app': { error: [errorRow('q1', 'qa only')] } } });
    await run();
    expect(queries.map((q) => q.groups)).toEqual([...triage.QUERIES.map(() => ['/pactlab/dev/app']), ...triage.QUERIES.map(() => ['/pactlab/qa/app'])]);
    expect(calls.converse).toBe(0);
    expect(calls.emails).toHaveLength(1);
    const { subject, text } = calls.emails[0];
    expect(subject).toBe('Pactlab pre-production triage 2026-11-25: to look at dev 1, qa 1');
    expect(text).toContain('Bedrock is not enabled in this account');
    expect(text).toContain('Verdict: Unclassified — Bedrock not enabled in this account');
    expect(text).not.toMatch(/Likely bug|Fix sketch/);
    // Sectioned per environment: dev's finding never appears in qa's section, nor the reverse.
    const [devSection, qaSection] = text.split('=== qa ===');
    expect(devSection).toContain('=== dev ===');
    expect(devSection).toContain('dev only');
    expect(devSection).not.toContain('qa only');
    expect(qaSection).toContain('qa only');
    expect(qaSection).not.toContain('dev only');
    // Clusters, counts, first and last seen and a scrubbed sample are all there.
    expect(devSection).toMatch(/Count: 1 this window \(1 total\); first seen 2026-11-25T10:00:00\.000Z; last seen 2026-11-25T10:00:00\.000Z/);
    expect(devSection).toContain('Sample: {"service":"api","level":50');
  });

  it('opens env-scoped issues, dedupes against open ones per environment, and keeps state and watermarks per environment', async () => {
    const [qaCluster] = triage.cluster({ error: [errorRow('q1', 'qa only')] });
    const qa = triage.envProfile('qa');
    const { run, calls } = harness({
      environments: devAccount,
      rows: { '/pactlab/dev/app': { error: [errorRow('d1', 'dev only')] }, '/pactlab/qa/app': { error: [errorRow('q1', 'qa only')] } },
      open: { 'env:qa': [{ number: 9, html_url: 'https://github.com/kuramach/pactlab/issues/9', body: triage.marker(qaCluster.signature, qa) }] },
    });
    await run();
    expect(calls.openLabels).toEqual([
      ['env-triage', 'env:dev'],
      ['env-triage', 'env:qa'],
    ]);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0].title).toMatch(/^\[env-triage:dev\] /);
    expect(calls.created[0].labels).toEqual(['env-triage', 'env:dev']);
    expect(calls.created[0].body).toContain('<!-- env-triage-signature: dev ');
    expect(calls.created[0].body).toContain('| Environment | dev |');
    expect(calls.created[0].body).toContain('**Verdict:** Unclassified — Bedrock not enabled in this account');
    expect(calls.comments).toEqual([expect.objectContaining({ number: 9 })]);
    expect(calls.states.map((s) => s.pk.split('SIG#')[0]).sort()).toEqual(['dev#', 'qa#']);
    expect(calls.states.every((s) => s.status === 'unclassified')).toBe(true);
    expect(calls.watermarks.map(([, prefix]) => prefix)).toEqual(['dev#', 'qa#']);
  });

  it('a paused environment (no rows) says nothing; with nothing anywhere, no email at all', async () => {
    const quiet = harness({ environments: devAccount, rows: { '/pactlab/dev/app': { error: [errorRow('d1')] } } });
    await quiet.run();
    expect(quiet.calls.emails[0].text.split('=== qa ===')[1]).toContain('Nothing new or growing.');
    const silent = harness({ environments: devAccount });
    await silent.run();
    expect(silent.calls.emails).toHaveLength(0);
    // Both watermarks still move, so the next run starts from here.
    expect(silent.calls.watermarks.map(([, prefix]) => prefix)).toEqual(['dev#', 'qa#']);
  });

  it('in dry run writes the digest and env issue bodies to the log, and sends, opens and stores nothing', async () => {
    const { run, calls } = harness({ environments: devAccount, dryRun: true, rows: { '/pactlab/qa/app': { error: [errorRow('q1')] } } });
    expect(await run()).toMatchObject({ dryRun: true, environments: { dev: { triaged: 0 }, qa: { triaged: 1 } } });
    expect(calls.emails).toHaveLength(0);
    expect(calls.created).toHaveLength(0);
    expect(calls.states).toHaveLength(0);
    expect(calls.watermarks).toHaveLength(0);
    const issue = calls.logs.find((l) => l.message === 'dry run: issue');
    expect(issue).toMatchObject({ environment: 'qa', labels: ['env-triage', 'env:qa'] });
    expect(issue.title).toMatch(/^\[env-triage:qa\] /);
    expect(calls.logs.find((l) => l.message === 'dry run: digest').subject).toMatch(/^\[dry run\] Pactlab pre-production triage/);
  });

  it('a manual run may name one environment, so each has its own dry run', async () => {
    const { run, queries } = harness({ environments: devAccount, dryRun: true });
    await run({ dryRun: true, environments: ['qa'] });
    expect(new Set(queries.flatMap((q) => q.groups))).toEqual(new Set(['/pactlab/qa/app']));
    await expect(run({ environments: ['prod'] })).rejects.toThrow(/none of this deployment/);
  });
});

describe('stage, with Bedrock verdicts', () => {
  it('in dry run classifies like live and drafts env-scoped issues', async () => {
    const { run, calls } = harness({ environments: [{ name: 'stage', group: '/pactlab/stage/app' }], modelId: 'us.anthropic.claude-sonnet-5-5', dryRun: true, rows: { '/pactlab/stage/app': { error: [errorRow('s1')] } } });
    await run();
    expect(calls.converse).toBe(1);
    const digest = calls.logs.find((l) => l.message === 'dry run: digest');
    expect(digest.text).toContain('Verdict: Likely bug');
    expect(digest.text).toContain('Fix sketch: Guard it.');
    expect(digest.text).not.toContain('Bedrock is not enabled');
    expect(calls.logs.find((l) => l.message === 'dry run: issue').title).toBe('[env-triage:stage] Deal lookup throws');
  });
});

describe('the CDK resources per account', () => {
  const dev = platformStack(devConfig, { imageTag: 'abc1234' }).template;
  const qa = platformStack(qaConfig, { imageTag: 'abc1234' }).template;
  const stage = platformStack(stageConfig, { imageTag: 'abc1234' }).template;
  const statements = (template: typeof dev) =>
    Object.entries(template.findResources('AWS::IAM::Policy'))
      .filter(([id]) => id.includes('LogTriage'))
      .flatMap(([, policy]) => (policy as any).Properties.PolicyDocument.Statement as { Sid?: string; Action: string | string[]; Resource: unknown; Condition?: unknown }[]);
  const actionsOf = (template: typeof dev) => statements(template).flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));

  it('keeps every pre-production app log group at least 30 days, for sweeps after a long pause', () => {
    for (const [name, template] of [['dev', dev], ['qa', qa], ['stage', stage]] as const) {
      const groups = Object.values(template.findResources('AWS::Logs::LogGroup')) as { Properties: { LogGroupName?: string; RetentionInDays?: number } }[];
      expect(groups.find((g) => g.Properties.LogGroupName === `/pactlab/${name}/app`)?.Properties.RetentionInDays, name).toBeGreaterThanOrEqual(30);
    }
  });

  it('gives the dev account one deployment for dev and qa, cluster-only, in dry run, with its own token secret', () => {
    qa.resourceCountIs('AWS::DynamoDB::Table', 0);
    dev.hasResourceProperties('AWS::Events::Rule', { Name: 'pactlab-dev-log-triage', ScheduleExpression: 'cron(0 13 * * ? *)' });
    dev.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Environment: { Variables: Match.objectLike({ DRY_RUN: 'true', MODEL_ID: '', MAX_CLUSTERS: '10', ACCOUNT_LABEL: 'dev account', TRIAGE_ENVIRONMENTS: Match.anyValue() }) },
    });
    dev.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'pactlab-dev-log-triage', BillingMode: 'PAY_PER_REQUEST' });
    dev.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'pactlab/dev/github-triage', SecretString: 'unset' });
    expect(JSON.stringify(dev.findResources('AWS::Lambda::Function'))).toContain('/pactlab/qa/app');
  });

  it('dev’s role reads only dev’s and qa’s logs, has no Bedrock at all, and mails only the recipient', () => {
    const actions = actionsOf(dev);
    expect(actions.filter((a) => a.startsWith('bedrock:'))).toEqual([]);
    expect(actions.filter((a) => /^(logs:(Put|Delete|Create)|ecs:(Update|Run|Stop|Delete)|s3:|rds:|sts:)/.test(a))).toEqual([]);
    const query = statements(dev).find((s) => s.Sid === 'QueryEnvironmentLogs');
    expect(JSON.stringify(query?.Resource)).toContain('AppLogs');
    expect(JSON.stringify(query?.Resource)).toContain('log-group:/pactlab/qa/app:*');
    expect(JSON.stringify(query?.Resource)).not.toMatch(/stage|prod/);
    expect(statements(dev).find((s) => s.Sid === 'SendDigest')?.Condition).toMatchObject({ 'ForAllValues:StringEquals': { 'ses:Recipients': ['kumar@pactlab.ai'] } });
  });

  it('gives stage its own deployment with the one triage model, protected state and its own token secret', () => {
    stage.hasResourceProperties('AWS::Lambda::Function', { Handler: 'index.handler', Environment: { Variables: Match.objectLike({ MODEL_ID: 'us.anthropic.claude-sonnet-5-5', DRY_RUN: 'true' }) } });
    stage.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ TableName: 'pactlab-stage-log-triage' }) });
    stage.hasResource('AWS::SecretsManager::Secret', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ Name: 'pactlab/stage/github-triage' }) });
    const model = statements(stage).find((s) => s.Sid === 'TriageModel');
    expect(JSON.stringify(model?.Resource)).toContain('inference-profile/us.anthropic.claude-sonnet-5-5');
    expect(JSON.stringify(model?.Resource)).not.toContain('"*"');
    expect(JSON.stringify(statements(stage).find((s) => s.Sid === 'QueryEnvironmentLogs')?.Resource)).not.toContain('/pactlab/');
  });

  it('flips dev to verdicts by configuration alone: a model id adds exactly the model permission', () => {
    const flipped = { ...devConfig, logTriage: { ...devConfig.logTriage!, modelId: 'us.anthropic.claude-sonnet-5-5' } };
    const template = platformStack(flipped, { imageTag: 'abc1234' }).template;
    expect(actionsOf(template).filter((a) => a.startsWith('bedrock:'))).toEqual(['bedrock:InvokeModel']);
    template.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ MODEL_ID: 'us.anthropic.claude-sonnet-5-5' }) } });
  });
});

describe('approval becomes a task, for env-triage issues too', () => {
  const issue = {
    number: 77,
    html_url: 'https://github.com/kuramach/pactlab/issues/77',
    title: '[env-triage:qa] Seed import fails on SparseCo',
    labels: [{ name: 'env-triage' }, { name: 'env:qa' }, { name: 'triage-approved' }],
    body: triage.issueBody(
      { signature: '0123456789abcdef', verdict: 'unclassified', headline: 'x', summary: 'Not classified.', fixSketch: '', kind: 'job_failed', services: ['worker'], count: 4, total: 4, firstSeen: 0, lastSeen: 0, normalized: 'boom', anchor: '', samples: ['{"message":"job failed"}'] },
      { window: { start: 0, end: 60 }, logGroups: ['/pactlab/qa/app'] },
      triage.envProfile('qa'),
    ),
  };

  it('files a house-format task naming the environment, with the cluster detail quoted', () => {
    const text = task.renderTask({ id: 'T-170', issue });
    expect(text.split('\n')[0]).toBe('# T-170 — Pre-production triage (qa): Seed import fails on SparseCo');
    for (const header of ['Lane: api', 'Touches: apps/worker packages', `Issue: ${issue.html_url}`, 'Environment: qa']) expect(text).toContain(`\n${header}\n`);
    expect(text).toContain('in the **qa** environment');
    expect(text).toContain('> | Environment | qa |');
    expect(text).toContain('> | Services | worker |');
    expect(text).not.toContain('env-triage-signature');
    expect(text).toContain('daily qa triage digest');
  });

  it('reads the environment from the detail, else the title; never from a name that is not one', () => {
    expect(task.environmentOf({ ...issue, body: 'no table' })).toBe('qa');
    expect(task.environmentOf({ ...issue, title: '[env-triage:Q A] x', body: 'no table' })).toBeNull();
    expect(task.environmentOf({ title: '[live-triage] x', body: '' })).toBeNull();
  });

  it('still files once per issue, across both label families', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-'));
    mkdirSync(join(dir, 'ready'), { recursive: true });
    writeFileSync(join(dir, 'ready', 'T-170.md'), task.renderTask({ id: 'T-170', issue }));
    expect(task.existingTaskFor(dir, issue.html_url)).toEqual({ id: 'T-170', file: join('tasks', 'ready', 'T-170.md') });
  });
});
