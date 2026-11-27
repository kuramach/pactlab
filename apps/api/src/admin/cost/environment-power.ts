import { ENVIRONMENT_POWER_STATES, hibernatedCostSchema, hibernationRecordSchema, type EnvironmentPower, type EnvironmentPowerState } from '@pactlab/contracts';

export type PowerEnvironment = 'dev' | 'qa' | 'stage';
const HIBERNATABLE: readonly PowerEnvironment[] = ['dev', 'qa', 'stage'];

/** Reads one environment's parameters; `null` for one that does not exist. */
export interface ParameterReader {
  get(name: string): Promise<{ value: string; changedAt: Date | null } | null>;
}

/** Where the Hosting cost page's environment states come from (ADR 0063): SSM, in each environment's account. */
export interface EnvironmentPowerSource {
  read(): Promise<EnvironmentPower[]>;
}

const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, text: string | undefined): T | null => {
  if (!text) return null;
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

/** One environment's state from its three parameters. The values are untrusted: anything unexpected reads as unknown. */
export async function readEnvironment(environment: PowerEnvironment, reader: ParameterReader | null): Promise<EnvironmentPower> {
  const base = { environment, alwaysOn: false, power: null, since: null, hibernation: null, costWhileHibernated: null } as const;
  if (!reader) return { ...base, unreadable: 'NOT_CONFIGURED' };
  try {
    const [power, hibernation, cost] = await Promise.all(['power', 'hibernation', 'hibernated-cost'].map((name) => reader.get(`/pactlab/${environment}/${name}`)));
    const value = power?.value ?? '';
    const state = (ENVIRONMENT_POWER_STATES as readonly string[]).includes(value) ? (value as EnvironmentPowerState) : null;
    return {
      ...base,
      power: state,
      since: power?.changedAt?.toISOString() ?? null,
      hibernation: state === 'hibernated' || state === 'rebuilding' || state === 'hibernating' ? parse(hibernationRecordSchema, hibernation?.value) : null,
      costWhileHibernated: parse(hibernatedCostSchema, cost?.value),
      unreadable: power ? null : 'UNAVAILABLE',
    };
  } catch {
    return { ...base, unreadable: 'UNAVAILABLE' };
  }
}

/**
 * Live reads dev, qa and stage through each account's read-only `pactlab-<env>-power-read` role; any environment
 * reads its own state directly. Read at most once a minute; the page shows when it could not read one.
 */
export class SsmEnvironmentPowerSource implements EnvironmentPowerSource {
  private cached: { at: number; value: EnvironmentPower[] } | null = null;

  constructor(
    private readonly options: {
      readonly region: string;
      /** This deployment's environment (its own state is read without a role); `prod` for live. */
      readonly self: string;
      readonly roles: Partial<Record<PowerEnvironment, string>>;
      readonly readerFor?: (environment: PowerEnvironment) => Promise<ParameterReader | null>;
      readonly now?: () => number;
    },
  ) {}

  private async reader(environment: PowerEnvironment): Promise<ParameterReader | null> {
    if (this.options.readerFor) return this.options.readerFor(environment);
    const role = this.options.roles[environment];
    const own = environment === this.options.self;
    if (!own && !role) return null;
    const [{ SSMClient, GetParameterCommand }, { fromTemporaryCredentials }] = await Promise.all([import('@aws-sdk/client-ssm'), import('@aws-sdk/credential-providers')]);
    const client = new SSMClient({
      region: this.options.region,
      ...(own || !role ? {} : { credentials: fromTemporaryCredentials({ params: { RoleArn: role, RoleSessionName: 'pactlab-hosting-cost-power', DurationSeconds: 900 } }) }),
    });
    return {
      async get(name) {
        try {
          const { Parameter } = await client.send(new GetParameterCommand({ Name: name }));
          return Parameter?.Value ? { value: Parameter.Value, changedAt: Parameter.LastModifiedDate ?? null } : null;
        } catch (error) {
          if (error instanceof Error && error.name === 'ParameterNotFound') return null;
          throw error;
        }
      },
    };
  }

  async read(): Promise<EnvironmentPower[]> {
    const now = this.options.now?.() ?? Date.now();
    if (this.cached && now - this.cached.at < 60_000) return this.cached.value;
    const value: EnvironmentPower[] = [
      ...(await Promise.all(
        HIBERNATABLE.map(async (environment) =>
          readEnvironment(
            environment,
            // handled: an account that cannot be reached shows as "Not readable from here" on the Hosting cost page.
            await this.reader(environment).catch(() => null),
          ),
        ),
      )),
      { environment: 'prod', alwaysOn: true, power: 'awake', since: null, hibernation: null, costWhileHibernated: null, unreadable: null },
    ];
    this.cached = { at: now, value };
    return value;
  }
}

/** `dev=<arn>,qa=<arn>,stage=<arn>` (CDK passes it as ENVIRONMENT_POWER_ROLES); anything malformed is ignored. */
export function powerRolesFrom(text: string | undefined): Partial<Record<PowerEnvironment, string>> {
  const roles: Partial<Record<PowerEnvironment, string>> = {};
  for (const entry of (text ?? '').split(',')) {
    const [environment, arn] = entry.split('=');
    if (environment && arn && (HIBERNATABLE as readonly string[]).includes(environment) && /^arn:aws[a-z-]*:iam::\d{12}:role\/pactlab-(dev|qa|stage)-power-read$/.test(arn)) roles[environment as PowerEnvironment] = arn;
  }
  return roles;
}
