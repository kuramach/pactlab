import { ArnFormat, CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import type * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2Targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as rds from 'aws-cdk-lib/aws-rds';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import type { EnvironmentName } from '../config';

const lambdaDir = (name: string) => fileURLToPath(new URL(`../lambda/${name}`, import.meta.url));
export const wakeMachineName = (env: EnvironmentName) => `pactlab-${env}-wake`;
export const powerParameterName = (env: EnvironmentName) => `/pactlab/${env}/power`;
/** Awake, the wake page's rule matches a path nothing uses; paused, it matches everything. */
export const NEVER_MATCHING_PATH = '/__pactlab-paused/*';

export interface IdlePauseProps {
  readonly env: EnvironmentName;
  readonly idleMinutes: number;
  readonly cluster: ecs.ICluster;
  readonly services: readonly { readonly service: ecs.FargateService; readonly desiredCount: number }[];
  readonly database: rds.DatabaseInstance;
  readonly listener: elbv2.ApplicationListener;
  readonly targetGroups: { readonly web: elbv2.ApplicationTargetGroup; readonly api: elbv2.ApplicationTargetGroup };
  /** For the idle check's request count (the API target group's metric on this load balancer). */
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  /** On a shared listener: the environment's host and priority block, so pausing it never touches another environment. */
  readonly ruleScope?: { readonly host: string; readonly priorityBase: number };
}

/**
 * Only production runs all the time (Kumar, 2026-10-30; ADR 0019). After an
 * idle window with no request to the API (real use: the web app calls the
 * API for a person; bots browsing pages do not), the environment pauses: the
 * load balancer shows the wake page, the services scale to zero, the database
 * stops. The load balancer, NAT and Redis stay, so addresses and DNS never
 * change. The wake page's button (a POST) or the wake workflow brings it back.
 */
export class IdlePause extends Construct {
  readonly wakeMachine: sfn.StateMachine;
  readonly powerParameter: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: IdlePauseProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const { env } = props;

    this.powerParameter = new ssm.StringParameter(this, 'Power', {
      parameterName: powerParameterName(env),
      description: `Pactlab ${env}: awake, paused or waking (idle pause, ADR 0019)`,
      stringValue: 'awake',
    });

    // The wake page, behind a top-priority rule that matches nothing while awake.
    const wakePage = new lambda.Function(this, 'WakePage', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(lambdaDir('wake-page')),
      timeout: Duration.seconds(10),
      memorySize: 256,
      description: `Pactlab ${env}: the page shown while paused, and its Wake button`,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: { ENV_NAME: env, POWER_PARAMETER: this.powerParameter.parameterName },
    });
    const ruleScope = props.ruleScope;
    const wakeRule = new elbv2.ApplicationListenerRule(this, 'WakeRule', {
      listener: props.listener,
      priority: ruleScope ? ruleScope.priorityBase + 1 : 1,
      conditions: [...(ruleScope ? [elbv2.ListenerCondition.hostHeaders([ruleScope.host])] : []), elbv2.ListenerCondition.pathPatterns([NEVER_MATCHING_PATH])],
      targetGroups: [new elbv2.ApplicationTargetGroup(this, 'WakeTargets', { targets: [new elbv2Targets.LambdaTarget(wakePage)] })],
    });

    // One function performs each step; the state machines do the waiting.
    const power = new lambda.Function(this, 'PowerSteps', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(lambdaDir('power')),
      timeout: Duration.minutes(1),
      memorySize: 256,
      description: `Pactlab ${env}: pause and wake steps`,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        CLUSTER: props.cluster.clusterName,
        SERVICES: stack.toJsonString(props.services.map(({ service, desiredCount }) => ({ name: service.serviceName, desiredCount }))),
        TARGET_GROUPS: stack.toJsonString([props.targetGroups.web.targetGroupArn, props.targetGroups.api.targetGroupArn]),
        DB_INSTANCE: props.database.instanceIdentifier,
        RULE_ARN: wakeRule.listenerRuleArn,
        // Shared listener: the rule keeps its host condition when its path changes.
        RULE_HOST: ruleScope?.host ?? '',
        POWER_PARAMETER: this.powerParameter.parameterName,
        IDLE_MINUTES: String(props.idleMinutes),
        LOAD_BALANCER: props.loadBalancer.loadBalancerFullName,
        API_TARGET_GROUP: props.targetGroups.api.targetGroupFullName,
      },
    });
    this.powerParameter.grantRead(power);
    this.powerParameter.grantWrite(power);
    power.addToRolePolicy(new iam.PolicyStatement({ sid: 'Services', actions: ['ecs:UpdateService'], resources: props.services.map(({ service }) => service.serviceArn) }));
    power.addToRolePolicy(
      new iam.PolicyStatement({ sid: 'Database', actions: ['rds:StopDBInstance', 'rds:StartDBInstance', 'rds:DescribeDBInstances'], resources: [props.database.instanceArn] }),
    );
    power.addToRolePolicy(new iam.PolicyStatement({ sid: 'Route', actions: ['elasticloadbalancing:ModifyRule'], resources: [wakeRule.listenerRuleArn] }));
    // DescribeTargetHealth has no resource-level permissions.
    power.addToRolePolicy(new iam.PolicyStatement({ sid: 'Health', actions: ['elasticloadbalancing:DescribeTargetHealth'], resources: ['*'] }));
    // GetMetricStatistics has no resource-level permissions.
    power.addToRolePolicy(new iam.PolicyStatement({ sid: 'ReadRequests', actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] }));

    const step = (name: string, id = name) =>
      new tasks.LambdaInvoke(this, `Step${id}`, { lambdaFunction: power, payload: sfn.TaskInput.fromObject({ step: name }), payloadResponseOnly: true, resultPath: '$.result' });

    // Wake: start the database, wait for it, start the services, wait until both serve, then route back to the app.
    const waitForDatabase = new sfn.Wait(this, 'WaitForDatabase', { time: sfn.WaitTime.duration(Duration.seconds(30)) });
    const waitForTargets = new sfn.Wait(this, 'WaitForTargets', { time: sfn.WaitTime.duration(Duration.seconds(20)) });
    const finish = step('finishWake', 'FinishWake');
    const targetsHealthy = step('targetsHealthy', 'TargetsHealthy');
    const servicesUp = step('startServices', 'StartServices')
      .next(waitForTargets)
      .next(targetsHealthy)
      .next(new sfn.Choice(this, 'Serving').when(sfn.Condition.booleanEquals('$.result.healthy', true), finish).otherwise(waitForTargets));
    const databaseReady = step('databaseReady', 'DatabaseReady');
    this.wakeMachine = new sfn.StateMachine(this, 'WakeMachine', {
      stateMachineName: wakeMachineName(env),
      timeout: Duration.minutes(30),
      definitionBody: sfn.DefinitionBody.fromChainable(
        step('startWake', 'StartWake')
          .next(waitForDatabase)
          .next(databaseReady)
          .next(new sfn.Choice(this, 'DatabaseUp').when(sfn.Condition.booleanEquals('$.result.ready', true), servicesUp).otherwise(waitForDatabase)),
      ),
    });

    // By name, not by reference: the wake machine depends (through the steps and the rule) on this page.
    const wakeMachineArn = stack.formatArn({ service: 'states', resource: 'stateMachine', resourceName: wakeMachineName(env), arnFormat: ArnFormat.COLON_RESOURCE_NAME });
    wakePage.addEnvironment('WAKE_STATE_MACHINE_ARN', wakeMachineArn);
    this.powerParameter.grantRead(wakePage);
    wakePage.addToRolePolicy(new iam.PolicyStatement({ sid: 'StartWake', actions: ['states:StartExecution', 'states:ListExecutions'], resources: [wakeMachineArn] }));
    // Progress while waking: which step the wake is on, and how long recent wakes took.
    const wakeExecutions = stack.formatArn({ service: 'states', resource: 'execution', resourceName: `${wakeMachineName(env)}:*`, arnFormat: ArnFormat.COLON_RESOURCE_NAME });
    wakePage.addToRolePolicy(new iam.PolicyStatement({ sid: 'WakeProgress', actions: ['states:GetExecutionHistory'], resources: [wakeExecutions] }));

    // Every 5 minutes: pause if awake for the whole idle window with no API request (never right after a wake).
    // Daily: AWS restarts a database stopped for 7 days; stop it again while still paused.
    new events.Rule(this, 'IdleCheck', {
      description: `Pause ${env} after ${props.idleMinutes} idle minutes`,
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new eventTargets.LambdaFunction(power, { event: events.RuleTargetInput.fromObject({ step: 'checkIdle' }) })],
    });
    new events.Rule(this, 'KeepStoppedDaily', {
      description: `Keep a paused ${env} database stopped`,
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [new eventTargets.LambdaFunction(power, { event: events.RuleTargetInput.fromObject({ step: 'keepStopped' }) })],
    });

    new CfnOutput(stack, 'WakeStateMachineArn', { value: this.wakeMachine.stateMachineArn });
    new CfnOutput(stack, 'PowerParameter', { value: this.powerParameter.parameterName });
  }
}
