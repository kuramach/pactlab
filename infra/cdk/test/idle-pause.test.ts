import { createRequire } from 'node:module';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { devConfig, ENVIRONMENTS, ENVIRONMENT_NAMES } from '../config';
import { NEVER_MATCHING_PATH } from '../lib/idle-pause';
import { PactlabPlatformStack } from '../lib/platform-stack';

const require = createRequire(import.meta.url);
type Steps = Record<string, () => Promise<Record<string, unknown>>>;
const { makeSteps, NEVER, EVERYTHING } = require('../lambda/power/index.js') as { makeSteps: (aws: object, env: object) => Steps; NEVER: string; EVERYTHING: string };
const { makeHandler } = require('../lambda/wake-page/index.js') as {
  makeHandler: (deps: object) => (event: { httpMethod: string }) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
};

describe('only production runs all the time (ADR 0019)', () => {
  it('pauses every environment but production after an hour idle', () => {
    for (const name of ENVIRONMENT_NAMES) {
      if (name === 'prod') expect(ENVIRONMENTS[name].idlePause, name).toBeUndefined();
      else expect(ENVIRONMENTS[name].idlePause, name).toEqual({ idleMinutes: 60 });
    }
  });

  const template = Template.fromStack(new PactlabPlatformStack(new App(), 'PactlabDev', { config: devConfig, imageTag: 'abc1234' }));

  it('pauses on an hour without API requests, and keeps a paused database stopped daily', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'RequestCount',
      Namespace: 'AWS/ApplicationELB',
      Statistic: 'Sum',
      Period: 300,
      EvaluationPeriods: 12,
      Threshold: 1,
      ComparisonOperator: 'LessThanThreshold',
      TreatMissingData: 'breaching',
    });
    template.hasResourceProperties('AWS::Events::Rule', { EventPattern: Match.objectLike({ 'detail-type': ['CloudWatch Alarm State Change'] }) });
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(1 day)' });
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', { StateMachineName: 'pactlab-dev-pause' });
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', { StateMachineName: 'pactlab-dev-wake' });
    template.hasResourceProperties('AWS::SSM::Parameter', { Name: '/pactlab/dev/power', Value: 'awake' });
  });

  it('puts the wake page first, on a path nothing uses until the environment pauses', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Priority: 1,
      Conditions: [{ Field: 'path-pattern', PathPatternConfig: { Values: [NEVER_MATCHING_PATH] } }],
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { TargetType: 'lambda' });
  });

  it('lets the wake page start only its own wake, and the steps touch only this environment', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('states:StartExecution');
    expect(policies).toContain('rds:StopDBInstance');
    expect(policies).toContain('elasticloadbalancing:ModifyRule');
    expect(policies).not.toMatch(/"rds:StopDBInstance"[^\]]*"Resource":"\*"/);
  });

  it('has no pause in production', () => {
    const prod = Template.fromStack(new PactlabPlatformStack(new App(), 'PactlabProd', { config: { ...ENVIRONMENTS.prod, service: devConfig.service }, imageTag: 'abc1234' }));
    prod.resourceCountIs('AWS::StepFunctions::StateMachine', 0);
    prod.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });
});

/** A fake of the AWS calls, recording what each step did. */
function fakeAws(state: { power: string; db: string; healthy?: number }) {
  const calls: string[] = [];
  return {
    calls,
    state,
    aws: {
      getPower: async () => state.power,
      putPower: async (_name: string, value: string) => {
        calls.push(`power=${value}`);
        state.power = value;
      },
      setRulePath: async (_rule: string, path: string) => void calls.push(`route ${path}`),
      setDesiredCount: async (_cluster: string, service: string, count: number) => void calls.push(`${service}=${count}`),
      stopDatabase: async () => {
        calls.push('db stop');
        if (state.db !== 'available') throw Object.assign(new Error('not available'), { name: 'InvalidDBInstanceStateFault' });
        state.db = 'stopping';
      },
      startDatabase: async () => {
        calls.push('db start');
        state.db = 'starting';
      },
      databaseStatus: async () => state.db,
      healthyTargets: async () => state.healthy ?? 0,
      resetAlarm: async () => void calls.push('alarm reset'),
    },
  };
}
const ENV = { SERVICES: JSON.stringify([{ name: 'web', desiredCount: 1 }, { name: 'api', desiredCount: 1 }, { name: 'worker', desiredCount: 1 }]), TARGET_GROUPS: JSON.stringify(['tg-web', 'tg-api']), RULE_ARN: 'rule', POWER_PARAMETER: 'p', DB_INSTANCE: 'db', CLUSTER: 'c', ALARM_NAME: 'a' };

describe('pause and wake steps', () => {
  it('pauses an awake environment: wake page first, services to zero, database stopped', async () => {
    const fake = fakeAws({ power: 'awake', db: 'available' });
    expect(await makeSteps(fake.aws, ENV)['pause']?.()).toEqual({ paused: true });
    expect(fake.calls).toEqual([`route ${EVERYTHING}`, 'web=0', 'api=0', 'worker=0', 'db stop', 'power=paused']);
  });

  it('never pauses twice, nor mid-wake', async () => {
    for (const power of ['paused', 'waking']) {
      const fake = fakeAws({ power, db: 'available' });
      expect(await makeSteps(fake.aws, ENV)['pause']?.()).toEqual({ paused: false });
      expect(fake.calls).toEqual([]);
    }
  });

  it('wakes in order and routes back to the app last, re-arming the idle alarm', async () => {
    const fake = fakeAws({ power: 'paused', db: 'stopped' });
    const steps = makeSteps(fake.aws, ENV);
    await steps['startWake']?.();
    expect(await steps['databaseReady']?.()).toEqual({ ready: false });
    fake.state.db = 'available';
    expect(await steps['databaseReady']?.()).toEqual({ ready: true });
    await steps['startServices']?.();
    expect(await steps['targetsHealthy']?.()).toEqual({ healthy: false });
    fake.state.healthy = 1;
    expect(await steps['targetsHealthy']?.()).toEqual({ healthy: true });
    await steps['finishWake']?.();
    expect(fake.calls).toEqual(['power=waking', 'db start', 'web=1', 'api=1', 'worker=1', `route ${NEVER}`, 'power=awake', 'alarm reset']);
  });

  it('stops a paused database that AWS restarted, and leaves an awake one alone', async () => {
    const restarted = fakeAws({ power: 'paused', db: 'available' });
    expect(await makeSteps(restarted.aws, ENV)['keepStopped']?.()).toEqual({ stopped: true });
    const awake = fakeAws({ power: 'awake', db: 'available' });
    expect(await makeSteps(awake.aws, ENV)['keepStopped']?.()).toEqual({ stopped: false });
    expect(awake.calls).toEqual([]);
  });
});

describe('the wake page', () => {
  const page = (power: { value: string; version: number }) => {
    const started: string[] = [];
    return { started, handler: makeHandler({ envName: 'dev', readPower: async () => power, startWake: async (name: string) => void started.push(name) }) };
  };

  it('shows the paused page to a GET and never wakes from it (crawlers only GET)', async () => {
    const { started, handler } = page({ value: 'paused', version: 7 });
    const response = await handler({ httpMethod: 'GET' });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Wake it up');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(started).toEqual([]);
  });

  it('starts one wake per pause from the button, and only shows progress while waking', async () => {
    const paused = page({ value: 'paused', version: 7 });
    expect((await paused.handler({ httpMethod: 'POST' })).statusCode).toBe(303);
    expect(paused.started).toEqual(['wake-7']);
    const waking = page({ value: 'waking', version: 8 });
    const response = await waking.handler({ httpMethod: 'POST' });
    expect(waking.started).toEqual([]);
    expect(response.body).toContain('Waking up');
    expect(response.body).not.toContain('<form');
  });
});
