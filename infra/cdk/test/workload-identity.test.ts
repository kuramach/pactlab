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

  it('the Bedrock statement names its actions and Claude resources: no bedrock:*, no Resource *', () => {
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (policy) => (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement,
    );
    const bedrock = statements.filter((statement) => [statement.Action].flat().some((action) => action.startsWith('bedrock:')));
    expect(bedrock.length).toBeGreaterThan(0);
    for (const statement of bedrock) {
      expect([statement.Action].flat()).not.toContain('bedrock:*');
      expect([statement.Action].flat().every((action) => /^bedrock:(InvokeModel|InvokeModelWithResponseStream|Converse|ConverseStream)$/.test(action))).toBe(true);
      const resources = [statement.Resource].flat();
      expect(resources).not.toContain('*');
      expect(JSON.stringify(resources)).toMatch(/anthropic\.claude-/);
      expect(JSON.stringify(resources)).not.toMatch(/foundation-model\/\*"|inference-profile\/\*"/);
    }
  });
});
