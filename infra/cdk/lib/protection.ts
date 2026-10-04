import { Annotations, CfnDeletionPolicy, CfnResource, Stack, type IAspect } from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { IConstruct } from 'constructs';

/** Resource types whose loss is data loss. Redis queues are rebuildable and excluded. */
export const STATEFUL_RESOURCE_TYPES = [
  'AWS::RDS::DBInstance',
  'AWS::RDS::DBCluster',
  'AWS::S3::Bucket',
  'AWS::KMS::Key',
  'AWS::SecretsManager::Secret',
] as const;

/**
 * Policy check for protected environments (stage, prod). Synthesis fails when
 * the stack lacks termination protection, a stateful resource would be deleted
 * or replaced without being retained, or an RDS database lacks deletion
 * protection. Never relax this to make a deploy pass.
 */
export class StatefulProtectionAspect implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof Stack && !node.terminationProtection) {
      Annotations.of(node).addError(
        'Protected environment stack must enable termination protection',
      );
    }
    if (!(node instanceof CfnResource)) return;
    if (!(STATEFUL_RESOURCE_TYPES as readonly string[]).includes(node.cfnResourceType)) return;
    const { deletionPolicy, updateReplacePolicy } = node.cfnOptions;
    if (
      deletionPolicy !== CfnDeletionPolicy.RETAIN ||
      updateReplacePolicy !== CfnDeletionPolicy.RETAIN
    ) {
      Annotations.of(node).addError(
        `${node.cfnResourceType} must RETAIN on deletion and replacement in a protected environment`,
      );
    }
    if (
      (node instanceof rds.CfnDBInstance || node instanceof rds.CfnDBCluster) &&
      node.deletionProtection !== true
    ) {
      Annotations.of(node).addError(`${node.cfnResourceType} must enable deletion protection`);
    }
  }
}

/**
 * Fail closed when the credentials in use belong to a different account than
 * the environment declares. `declared` comes from CDK context; `caller` from
 * the CDK CLI (CDK_DEFAULT_ACCOUNT), which resolves the named profile.
 */
export function assertTargetAccount(
  environment: string,
  declared: string | undefined,
  caller: string | undefined,
): void {
  if (declared !== undefined && !/^\d{12}$/.test(declared)) {
    throw new Error(`pactlab:${environment}:account must be a 12-digit AWS account id`);
  }
  if (declared !== undefined && caller !== undefined && declared !== caller) {
    throw new Error(
      `Refusing to synthesize ${environment}: credentials resolve to a different account than declared`,
    );
  }
}
