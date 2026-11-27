import { App } from 'aws-cdk-lib';
import { ENVIRONMENTS, type EnvironmentName, type PowerShape } from '../config';
import { hibernatedCost } from './hibernation-cost';
import { PactlabNonliveBaseStack } from './nonlive-base-stack';
import { PactlabPlatformStack } from './platform-stack';

interface TemplateJson {
  readonly Resources?: Record<string, { readonly Type: string; readonly Properties?: unknown; readonly DeletionPolicy?: string }>;
}
export interface PlanEntry {
  readonly logicalId: string;
  readonly type: string;
  readonly what: string;
}
export interface StackPlan {
  readonly stack: string;
  readonly deleted: readonly PlanEntry[];
  readonly kept: readonly PlanEntry[];
}

/** Plain names for what a stack holds, for the dry run and the run summary. */
const WHAT: Readonly<Record<string, string>> = {
  'AWS::EC2::VPC': 'network (VPC)',
  'AWS::EC2::Subnet': 'subnet',
  'AWS::EC2::Instance': 'NAT instance',
  'AWS::EC2::NatGateway': 'NAT gateway',
  'AWS::EC2::EIP': 'public IPv4 address (Elastic IP)',
  'AWS::EC2::SecurityGroup': 'security group',
  'AWS::EC2::FlowLog': 'VPC flow log',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'load balancer',
  'AWS::ElasticLoadBalancingV2::Listener': 'load balancer listener',
  'AWS::ElasticLoadBalancingV2::ListenerRule': 'load balancer rule',
  'AWS::ElasticLoadBalancingV2::TargetGroup': 'target group',
  'AWS::ECS::Cluster': 'ECS cluster',
  'AWS::ECS::Service': 'ECS service',
  'AWS::ECS::TaskDefinition': 'task definition',
  'AWS::RDS::DBInstance': 'database instance (deleted by the workflow after its snapshot)',
  'AWS::RDS::DBSubnetGroup': 'database subnet group',
  'AWS::RDS::DBParameterGroup': 'database parameter group',
  'AWS::ElastiCache::ReplicationGroup': 'Redis',
  'AWS::ElastiCache::SubnetGroup': 'Redis subnet group',
  'AWS::StepFunctions::StateMachine': 'wake state machine (idle pause)',
  'AWS::Events::Rule': 'scheduled rule',
  'AWS::Lambda::Function': 'function',
  'AWS::IAM::Role': 'IAM role',
  'AWS::IAM::Policy': 'IAM policy',
  'AWS::SecretsManager::Secret': 'secret',
  'AWS::KMS::Key': 'KMS key',
  'AWS::S3::Bucket': 'bucket',
  'AWS::SSM::Parameter': 'parameter',
  'AWS::Logs::LogGroup': 'log group',
  'AWS::CertificateManager::Certificate': 'certificate',
  'AWS::SES::EmailIdentity': 'SES identity',
  'AWS::SES::ConfigurationSet': 'SES configuration set',
  'AWS::SNS::Topic': 'SNS topic',
  'AWS::Route53::HostedZone': 'Route 53 zone',
  'AWS::Route53::RecordSet': 'DNS record',
  'AWS::CloudFront::Distribution': 'sleep page (CloudFront)',
  'AWS::DynamoDB::Table': 'table',
};
const entry = (logicalId: string, type: string): PlanEntry => ({ logicalId, type, what: WHAT[type] ?? type });

/** What hibernating deletes (in the awake template, not the hibernated one) and keeps (in both), by logical ID. */
export function stackPlan(stack: string, awake: TemplateJson, hibernated: TemplateJson): StackPlan {
  const a = awake.Resources ?? {};
  const h = hibernated.Resources ?? {};
  for (const [id, resource] of Object.entries(h)) {
    if (!a[id]) throw new Error(`${stack}: ${id} (${resource.Type}) exists only when hibernated; a hibernated stack holds only what the awake one has`);
    if (a[id].Type !== resource.Type) throw new Error(`${stack}: ${id} changes type between shapes`);
  }
  const typeOf = (id: string) => a[id]?.Type ?? '';
  const sorted = (ids: string[]) => ids.sort((x, y) => (typeOf(x) + x).localeCompare(typeOf(y) + y)).map((id) => entry(id, typeOf(id)));
  return { stack, deleted: sorted(Object.keys(a).filter((id) => !h[id])), kept: sorted(Object.keys(a).filter((id) => h[id])) };
}

const stackId = (name: EnvironmentName) => `Pactlab${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** Synthesize one environment (and the shared base) in a shape, as the CDK app does, with placeholder images. */
export function synthesizeShape(name: EnvironmentName, power: PowerShape, others: Partial<Record<EnvironmentName, PowerShape>> = {}) {
  const config = ENVIRONMENTS[name];
  const app = new App();
  const shared = Object.values(ENVIRONMENTS).filter((environment) => environment.shared);
  const powerOf = (env: EnvironmentName) => (env === name ? power : (others[env] ?? 'awake'));
  const base = config.shared
    ? new PactlabNonliveBaseStack(app, 'PactlabNonliveBase', {
        hosts: shared.flatMap((environment) => (environment.service ? [environment.service.domain] : [])),
        power: shared.every((environment) => powerOf(environment.name) === 'hibernated') ? 'hibernated' : 'awake',
      })
    : undefined;
  const stack = new PactlabPlatformStack(app, stackId(name), {
    config,
    imageTag: 'plan',
    power,
    sleepCertificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000',
    ...(base ? { sharedBase: base } : {}),
  });
  const assembly = app.synth();
  return { stack: assembly.getStackByName(stack.stackName).template as TemplateJson, base: base ? (assembly.getStackByName(base.stackName).template as TemplateJson) : undefined };
}

/**
 * The dry run (ADR 0063): exactly what hibernating `name` deletes and keeps, from the two templates. For dev and qa
 * the shared base is listed too, and is torn down only when the other environment on it is already hibernated.
 */
export function hibernationPlan(name: EnvironmentName, options: { neighbourHibernated?: boolean } = {}) {
  const config = ENVIRONMENTS[name];
  if (!config.hibernate) throw new Error(`${name} never hibernates (ADR 0063)${name === 'prod' ? ': live is always on' : ''}`);
  const neighbour = config.shared ? Object.values(ENVIRONMENTS).find((environment) => environment.shared && environment.name !== name)?.name : undefined;
  const others: Partial<Record<EnvironmentName, PowerShape>> = neighbour ? { [neighbour]: options.neighbourHibernated ? 'hibernated' : 'awake' } : {};
  const awake = synthesizeShape(name, 'awake', others);
  const asleep = synthesizeShape(name, 'hibernated', others);
  const stacks = [stackPlan(stackId(name), awake.stack, asleep.stack)];
  if (awake.base && asleep.base) stacks.push(stackPlan('PactlabNonliveBase', awake.base, asleep.base));
  const secrets = Object.values(asleep.stack.Resources ?? {}).filter((resource) => resource.Type === 'AWS::SecretsManager::Secret').length + (config.logTriage ? 1 : 0);
  return {
    environment: name,
    neighbour: neighbour ? { name: neighbour, hibernated: Boolean(options.neighbourHibernated) } : null,
    stacks,
    alsoKept: ['the hibernate snapshot and a final snapshot (encrypted with the data key, tagged pactlab:environment)', 'the ECR images it ran (tagged keep-…)', 'the environment site'],
    cost: hibernatedCost({ secrets, kmsKeys: 1, hostedZones: 1, snapshotMaxGiB: config.database.allocatedStorageGiB }),
  };
}

/** The dry run as text: grouped counts, then every resource by logical ID. */
export function planText(plan: ReturnType<typeof hibernationPlan>): string {
  const lines = [`Hibernate ${plan.environment} (dry run: nothing is changed)`];
  if (plan.neighbour) lines.push(`Shared base: ${plan.neighbour.hibernated ? `${plan.neighbour.name} is hibernated, so the base is torn down too` : `kept awake, because ${plan.neighbour.name} is awake`}`);
  for (const stack of plan.stacks) {
    for (const [label, entries] of [['Deleted', stack.deleted], ['Kept', stack.kept]] as const) {
      lines.push('', `${stack.stack}: ${label.toLowerCase()} (${entries.length})`);
      for (const item of entries) lines.push(`  ${label === 'Deleted' ? '-' : '='} ${item.what}: ${item.logicalId}`);
    }
  }
  lines.push('', 'Also kept:', ...plan.alsoKept.map((item) => `  = ${item}`), '', `Estimated cost while hibernated: $${plan.cost.low}–$${plan.cost.high} a month`);
  for (const line of plan.cost.lines) lines.push(`  ${line.item}: $${line.low}–$${line.high} (${line.basis})`);
  return lines.join('\n');
}
