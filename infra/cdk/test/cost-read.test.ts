import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { devConfig, prodConfig } from '../config';
import { PactlabCostReadStack } from '../lib/cost-read-stack';
import { PactlabPlatformStack } from '../lib/platform-stack';
import { platformStack } from './helpers';

const LIVE = '111111111111';
const PAYER = '222222222222';
const ROLE = `arn:aws:iam::${PAYER}:role/PactlabCostRead`;
type Statement = { Sid?: string; Action: string | string[]; Resource: unknown; Condition?: unknown; Principal?: unknown };

describe('hosting cost: the payer account role', () => {
  const template = Template.fromStack(new PactlabCostReadStack(new App(), 'PactlabCostRead', { liveAccountId: LIVE, env: { account: PAYER, region: 'us-east-1' } }));

  it('only live’s API task role may assume it, and it may only read costs', () => {
    const [role] = Object.values(template.findResources('AWS::IAM::Role')) as { Properties: { RoleName: string; AssumeRolePolicyDocument: { Statement: Statement[] } } }[];
    expect(role?.Properties.RoleName).toBe('PactlabCostRead');
    const trust = role!.Properties.AssumeRolePolicyDocument.Statement;
    expect(trust).toHaveLength(1);
    expect(JSON.stringify(trust[0]?.Principal)).toContain(`:iam::${LIVE}:root`);
    expect(trust[0]?.Condition).toEqual({ ArnLike: { 'aws:PrincipalArn': { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:iam::${LIVE}:role/PactlabProd-*ApiTaskRole*`]] } } });
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap((policy) => (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement);
    expect(statements).toEqual([{ Sid: 'ReadCosts', Effect: 'Allow', Action: ['ce:GetCostAndUsage', 'ce:GetDimensionValues', 'ce:GetTags'], Resource: '*' }]);
  });
});

describe('hosting cost: live reads through it', () => {
  const live = (context: Record<string, string>) => {
    const app = new App({ context });
    return Template.fromStack(new PactlabPlatformStack(app, 'PactlabProd', { config: prodConfig, imageTag: 'abc1234' }));
  };
  const apiStatements = (template: Template) =>
    Object.entries(template.findResources('AWS::IAM::Policy'))
      .filter(([, policy]) => JSON.stringify((policy as { Properties: { Roles: unknown } }).Properties.Roles).includes('ApiTaskRole'))
      .flatMap(([, policy]) => (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement);
  const apiEnvironment = (template: Template) =>
    Object.values(template.findResources('AWS::ECS::TaskDefinition'))
      .flatMap((definition) => (definition as { Properties: { ContainerDefinitions: { Name: string; Environment?: { Name: string; Value: unknown }[] }[] } }).Properties.ContainerDefinitions)
      .find((container) => container.Name === 'api')?.Environment ?? [];

  it('with the role named, the API may assume exactly that role, and is told it', () => {
    const template = live({ 'pactlab:prod:costExplorerRoleArn': ROLE });
    expect(apiStatements(template).find((statement) => statement.Sid === 'ReadHostingCost')).toMatchObject({ Action: 'sts:AssumeRole', Resource: ROLE });
    expect(apiEnvironment(template)).toContainEqual({ Name: 'COST_EXPLORER_ROLE_ARN', Value: ROLE });
  });

  it('without it (and anywhere but live), nothing is added', () => {
    expect(apiStatements(live({})).some((statement) => statement.Sid === 'ReadHostingCost')).toBe(false);
    const dev = platformStack(devConfig, { imageTag: 'abc1234' }).template;
    expect(JSON.stringify(dev.toJSON())).not.toContain('COST_EXPLORER_ROLE_ARN');
  });

  it('refuses any other role', () => {
    expect(() => live({ 'pactlab:prod:costExplorerRoleArn': `arn:aws:iam::${PAYER}:role/Admin` })).toThrow(/PactlabCostRead/);
  });
});
