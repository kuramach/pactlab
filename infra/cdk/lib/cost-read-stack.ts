import { Duration, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface PactlabCostReadStackProps extends StackProps {
  /** The live (prod) account, whose API task role may read costs. */
  readonly liveAccountId: string;
}

/** The role's name: the deploy passes its ARN to live (`pactlab:prod:costExplorerRoleArn`). */
export const COST_READ_ROLE_NAME = 'PactlabCostRead';

/**
 * Hosting cost (admin console, 2026-11-15): a read-only Cost Explorer role in the **payer
 * (management) account**, where Cost Explorer sees every linked account. Only live's API task
 * role may assume it. Deployed once by Kumar with payer credentials, never by an agent or CI:
 *   cdk deploy PactlabCostRead -c pactlab:cost:payerAccount=<id> -c pactlab:cost:liveAccount=<id> --profile <payer>
 * Cost Explorer has no resource-level permissions, so the actions are read-only and `Resource: *`.
 */
export class PactlabCostReadStack extends Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: PactlabCostReadStackProps) {
    super(scope, id, props);
    const { liveAccountId } = props;
    this.role = new iam.Role(this, 'CostRead', {
      roleName: COST_READ_ROLE_NAME,
      description: 'Pactlab live API: read Cost Explorer (hosting cost in the admin console)',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.AccountPrincipal(liveAccountId).withConditions({
        ArnLike: { 'aws:PrincipalArn': `arn:${this.partition}:iam::${liveAccountId}:role/PactlabProd-*ApiTaskRole*` },
      }),
    });
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadCosts', actions: ['ce:GetCostAndUsage', 'ce:GetDimensionValues', 'ce:GetTags'], resources: ['*'] }));
    Tags.of(this).add('pactlab:component', 'cost-read');
  }
}
