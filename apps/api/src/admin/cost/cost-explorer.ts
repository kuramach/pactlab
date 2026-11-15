import type { CostGranularity, HostingCostLine } from '@pactlab/db';

/** Where real spend comes from: Cost Explorer in the payer account, or a fake in tests. */
export interface CostSource {
  fetch(granularity: CostGranularity, from: string, to: string): Promise<HostingCostLine[]>;
}

/** The environment tag the stacks carry (`platform-stack.ts`): a group key is `pactlab:environment$<value>`. */
export const ENVIRONMENT_TAG = 'pactlab:environment';

export interface CostExplorerGroup {
  readonly Keys?: string[] | undefined;
  readonly Metrics?: Record<string, { Amount?: string | undefined; Unit?: string | undefined }> | undefined;
}

/** One Cost Explorer page → lines. Untagged spend (support, tax, the payer's own) is "untagged". */
export function linesFrom(results: readonly { TimePeriod?: { Start?: string | undefined } | undefined; Groups?: readonly CostExplorerGroup[] | undefined; Estimated?: boolean | undefined }[]): HostingCostLine[] {
  const lines: HostingCostLine[] = [];
  for (const result of results) {
    const periodStart = result.TimePeriod?.Start;
    if (!periodStart) continue;
    for (const group of result.Groups ?? []) {
      const [tag = '', service = 'Unknown'] = group.Keys ?? [];
      const value = tag.includes('$') ? tag.slice(tag.indexOf('$') + 1) : tag;
      const metric = group.Metrics?.['UnblendedCost'];
      if (!metric?.Amount) continue;
      lines.push({ periodStart, environment: value || 'untagged', service: service || 'Unknown', amount: metric.Amount, currency: metric.Unit === 'USD' || !metric.Unit ? 'USD' : metric.Unit, estimated: result.Estimated === true });
    }
  }
  return lines;
}

/**
 * Cost Explorer in the payer account, through a read-only role there (`PactlabCostRead`,
 * `infra/cdk/lib/cost-read-stack.ts`) that live's API task role may assume. Cost Explorer's
 * endpoint is us-east-1. Each request costs about $0.01; callers throttle.
 */
export class AwsCostExplorerSource implements CostSource {
  constructor(private readonly roleArn: string) {}

  async fetch(granularity: CostGranularity, from: string, to: string): Promise<HostingCostLine[]> {
    const [{ CostExplorerClient, GetCostAndUsageCommand }, { fromTemporaryCredentials }] = await Promise.all([import('@aws-sdk/client-cost-explorer'), import('@aws-sdk/credential-providers')]);
    const client = new CostExplorerClient({ region: 'us-east-1', credentials: fromTemporaryCredentials({ params: { RoleArn: this.roleArn, RoleSessionName: 'pactlab-hosting-cost', DurationSeconds: 900 } }) });
    const lines: HostingCostLine[] = [];
    let token: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const output = await client.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: from, End: to },
          Granularity: granularity,
          Metrics: ['UnblendedCost'],
          GroupBy: [
            { Type: 'TAG', Key: ENVIRONMENT_TAG },
            { Type: 'DIMENSION', Key: 'SERVICE' },
          ],
          ...(token ? { NextPageToken: token } : {}),
        }),
      );
      lines.push(...linesFrom(output.ResultsByTime ?? []));
      token = output.NextPageToken;
      if (!token) break;
    }
    return lines;
  }
}
