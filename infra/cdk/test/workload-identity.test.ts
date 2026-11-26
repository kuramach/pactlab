import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_NAMES, ENVIRONMENTS } from '../config';
import { platformStack } from './helpers';

type Container = { Name: string; Environment?: { Name: string; Value: unknown }[]; Secrets?: { Name: string }[] };
type Statement = { Sid?: string; Action: string | string[]; Resource: unknown };

/**
 * T-096 Part 1: deployed tasks reach Bedrock with their task role, never a
 * human sign-in or a long-lived key, and the role may call only Claude.
 */
describe.each(ENVIRONMENT_NAMES.filter((name) => ENVIRONMENTS[name].service))('%s: workload identity for AI (T-096)', (name) => {
  const { template } = platformStack(ENVIRONMENTS[name], { imageTag: 'abc1234' });

  it('no task carries an AWS profile or static AWS keys, as environment or secret', () => {
    const containers = Object.values(template.findResources('AWS::ECS::TaskDefinition')).flatMap(
      (definition) => (definition as { Properties: { ContainerDefinitions: Container[] } }).Properties.ContainerDefinitions,
    );
    expect(containers.length).toBeGreaterThan(0);
    for (const container of containers) {
      const names = [...(container.Environment ?? []), ...(container.Secrets ?? [])].map((item) => item.Name);
      expect(names.filter((variable) => /^AWS_(PROFILE|ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(variable)), container.Name).toEqual([]);
    }
  });

  it('connection credentials (T-007, T-147): the API reaches only its own prefix in Secrets Manager', () => {
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (policy) => (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement,
    );
    const credentials = statements.filter((statement) => statement.Sid === 'ConnectionCredentials');
    expect(credentials).toHaveLength(1);
    expect([credentials[0]?.Action].flat().sort()).toEqual(['secretsmanager:CreateSecret', 'secretsmanager:DeleteSecret', 'secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue']);
    expect(JSON.stringify(credentials[0]?.Resource)).toContain(`:secret:pactlab/${name}/credentials/*`);
    expect([credentials[0]?.Resource].flat()).not.toContain('*');
  });

  it('Bedrock: invoke any model in the account region (Kumar, 2026-11-20), list models; never bedrock:*, manage or provision', () => {
    // The app's task roles; live log triage's narrower grant (one model) is tested in log-triage.test.ts.
    const statements = Object.entries(template.findResources('AWS::IAM::Policy'))
      .filter(([id]) => !id.startsWith('LogTriage'))
      .flatMap(([, policy]) => (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement);
    const bedrock = statements.filter((statement) => [statement.Action].flat().some((action) => action.startsWith('bedrock:')));
    expect(bedrock.length).toBeGreaterThan(0);
    const invoke = /^bedrock:(InvokeModel|InvokeModelWithResponseStream|Converse|ConverseStream)$/;
    const list = /^bedrock:(ListFoundationModels|ListInferenceProfiles)$/;
    for (const statement of bedrock) {
      const actions = [statement.Action].flat();
      expect(actions).not.toContain('bedrock:*');
      expect(actions.every((action) => invoke.test(action) || list.test(action))).toBe(true);
      const resources = [statement.Resource].flat();
      if (actions.every((action) => list.test(action))) {
        // Listing models cannot be scoped to a resource in IAM; it reads metadata only.
        expect(resources).toEqual(['*']);
      } else {
        expect(actions.every((action) => invoke.test(action))).toBe(true);
        expect(resources).not.toContain('*');
        expect(JSON.stringify(resources)).toMatch(/foundation-model\/\*/);
      }
    }
  });
});
