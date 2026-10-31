'use strict';
/**
 * Pause and wake an environment (ADR 0019). Each step is one call from a
 * Step Functions state machine, which does the waiting and looping. The
 * environment's state lives in an SSM parameter: awake, paused or waking.
 *
 * While paused, the load balancer's top-priority rule matches every path and
 * sends it to the wake page; awake, the same rule matches a path nothing uses.
 */
const NEVER = '/__pactlab-paused/*';
const EVERYTHING = '/*';

/** The steps, with their AWS calls injected so they can be tested without AWS. */
function makeSteps(aws, env) {
  const services = JSON.parse(env.SERVICES); // [{ name, desiredCount }]
  const targetGroups = JSON.parse(env.TARGET_GROUPS); // [arn]
  const routeTo = (path) => aws.setRulePath(env.RULE_ARN, path, env.RULE_HOST || null);
  const ignore = (...names) => (error) => {
    if (!names.includes(error.name)) throw error;
  };

  return {
    async status() {
      return { power: await aws.getPower(env.POWER_PARAMETER) };
    },
    /** The alarm says nobody has used the app for the idle window: pause, if awake. */
    async pause() {
      if ((await aws.getPower(env.POWER_PARAMETER)) !== 'awake') return { paused: false };
      await routeTo(EVERYTHING);
      for (const service of services) await aws.setDesiredCount(env.CLUSTER, service.name, 0);
      await aws.stopDatabase(env.DB_INSTANCE).catch(ignore('InvalidDBInstanceStateFault'));
      await aws.putPower(env.POWER_PARAMETER, 'paused');
      return { paused: true };
    },
    /** Daily: AWS restarts a database stopped for 7 days; stop it again if still paused. */
    async keepStopped() {
      if ((await aws.getPower(env.POWER_PARAMETER)) !== 'paused') return { stopped: false };
      if ((await aws.databaseStatus(env.DB_INSTANCE)) !== 'available') return { stopped: false };
      await aws.stopDatabase(env.DB_INSTANCE).catch(ignore('InvalidDBInstanceStateFault'));
      return { stopped: true };
    },
    async startWake() {
      await aws.putPower(env.POWER_PARAMETER, 'waking');
      await aws.startDatabase(env.DB_INSTANCE).catch(ignore('InvalidDBInstanceStateFault'));
      return {};
    },
    async databaseReady() {
      return { ready: (await aws.databaseStatus(env.DB_INSTANCE)) === 'available' };
    },
    async startServices() {
      for (const service of services) await aws.setDesiredCount(env.CLUSTER, service.name, service.desiredCount);
      return {};
    },
    async targetsHealthy() {
      for (const arn of targetGroups) if ((await aws.healthyTargets(arn)) === 0) return { healthy: false };
      return { healthy: true };
    },
    /** Back to the app; re-arm the idle alarm so the next quiet hour pauses again. */
    async finishWake() {
      await routeTo(NEVER);
      await aws.putPower(env.POWER_PARAMETER, 'awake');
      await aws.resetAlarm(env.ALARM_NAME);
      return { awake: true };
    },
  };
}

let steps;
function live() {
  const { ECSClient, UpdateServiceCommand } = require('@aws-sdk/client-ecs');
  const { RDSClient, StartDBInstanceCommand, StopDBInstanceCommand, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
  const { ElasticLoadBalancingV2Client, ModifyRuleCommand, DescribeTargetHealthCommand } = require('@aws-sdk/client-elastic-load-balancing-v2');
  const { SSMClient, GetParameterCommand, PutParameterCommand } = require('@aws-sdk/client-ssm');
  const { CloudWatchClient, SetAlarmStateCommand } = require('@aws-sdk/client-cloudwatch');
  const ecs = new ECSClient({});
  const rds = new RDSClient({});
  const elb = new ElasticLoadBalancingV2Client({});
  const ssm = new SSMClient({});
  const cloudwatch = new CloudWatchClient({});
  return makeSteps(
    {
      getPower: async (name) => (await ssm.send(new GetParameterCommand({ Name: name }))).Parameter.Value,
      putPower: (name, value) => ssm.send(new PutParameterCommand({ Name: name, Value: value, Overwrite: true })),
      // On a shared listener the host condition is kept: pausing one environment never touches another.
      setRulePath: (ruleArn, path, host) =>
        elb.send(
          new ModifyRuleCommand({
            RuleArn: ruleArn,
            Conditions: [
              ...(host ? [{ Field: 'host-header', HostHeaderConfig: { Values: [host] } }] : []),
              { Field: 'path-pattern', PathPatternConfig: { Values: [path] } },
            ],
          }),
        ),
      setDesiredCount: (cluster, service, desiredCount) => ecs.send(new UpdateServiceCommand({ cluster, service, desiredCount })),
      stopDatabase: (id) => rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: id })),
      startDatabase: (id) => rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: id })),
      databaseStatus: async (id) => (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }))).DBInstances[0].DBInstanceStatus,
      healthyTargets: async (arn) =>
        (await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: arn }))).TargetHealthDescriptions.filter((target) => target.TargetHealth.State === 'healthy').length,
      resetAlarm: (name) => cloudwatch.send(new SetAlarmStateCommand({ AlarmName: name, StateValue: 'OK', StateReason: 'Environment woke up; idle timer restarts.' })),
    },
    process.env,
  );
}

/** Step Functions passes `{ "step": "<name>" }`. */
exports.handler = async (event) => {
  steps = steps || live();
  const step = steps[event.step];
  if (!step) throw new Error(`Unknown step: ${event.step}`);
  return step();
};
exports.makeSteps = makeSteps;
exports.NEVER = NEVER;
exports.EVERYTHING = EVERYTHING;
