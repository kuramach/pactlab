/**
 * What a hibernated environment still costs each month (ADR 0063), itemized from AWS's published
 * us-east-2 prices (Price List files of 2026-11-25, effective 2026-11-01, read 2026-11-27). Amounts
 * are kept in ten-thousandths of a dollar, so no money passes through floating point. The runbook
 * (docs/runbooks/hibernate.md) lists the sources; RDS snapshot storage is to be confirmed there.
 */
export const HIBERNATED_PRICES = {
  /** Secrets Manager, per secret-month (USE2-AWSSecretsManager-Secrets). */
  secretMonth: 4000,
  /** KMS customer managed key, per key-month (us-east-2-KMS-Keys). */
  kmsKeyMonth: 10000,
  /** Route 53 hosted zone, per zone-month (global). */
  hostedZoneMonth: 5000,
  /** RDS snapshot storage, per GB-month (AWS's blog figure for US East; to confirm for us-east-2). */
  snapshotGbMonth: 950,
} as const;

/** ECR storage of up to 20 images per repository, layers shared: an estimate, measured in the runbook. */
const ECR_RANGE = { low: 3000, high: 15000 };
/** S3, logs at 7-day retention, DynamoDB, Lambda, CloudFront, ACM and SES: within free tiers or close to them. */
const SMALL_RANGE = { low: 0, high: 2000 };

export interface HibernatedCostInput {
  /** Secrets the stack keeps (the template's own), plus any the scripts create (e.g. the log-triage token). */
  readonly secrets: number;
  readonly kmsKeys: number;
  readonly hostedZones: number;
  /** The snapshot is at most the allocated storage; the data held is usually far less. */
  readonly snapshotMaxGiB: number;
}

export interface HibernatedCostLine {
  readonly item: string;
  readonly low: string;
  readonly high: string;
  readonly basis: string;
}

/** Ten-thousandths of a dollar as dollars and cents, rounded half up, in integers only. */
const usd = (tenThousandths: number) => {
  const cents = (tenThousandths - (tenThousandths % 100)) / 100 + (tenThousandths % 100 >= 50 ? 1 : 0);
  return `${(cents - (cents % 100)) / 100}.${String(cents % 100).padStart(2, '0')}`;
};

/** The monthly cost while hibernated, line by line, with a low and a high end. */
export function hibernatedCost(input: HibernatedCostInput): { readonly lines: readonly HibernatedCostLine[]; readonly low: string; readonly high: string; readonly currency: 'USD' } {
  const fixed = (item: string, count: number, unit: number, basis: string) => ({ item, low: count * unit, high: count * unit, basis });
  const raw = [
    fixed('Secrets Manager', input.secrets, HIBERNATED_PRICES.secretMonth, `${input.secrets} secrets × $0.40`),
    fixed('KMS key', input.kmsKeys, HIBERNATED_PRICES.kmsKeyMonth, `${input.kmsKeys} key × $1.00 (up to $3 after two yearly rotations)`),
    fixed('Route 53 zone', input.hostedZones, HIBERNATED_PRICES.hostedZoneMonth, `${input.hostedZones} zone × $0.50`),
    { item: 'Database snapshot', low: 0, high: input.snapshotMaxGiB * HIBERNATED_PRICES.snapshotGbMonth, basis: `at most ${input.snapshotMaxGiB} GiB × $0.095; the data held, usually far less` },
    { item: 'Container images', ...ECR_RANGE, basis: 'up to 20 images per repository × $0.10/GB (estimate)' },
    { item: 'S3, logs, Lambda, CloudFront, DynamoDB', ...SMALL_RANGE, basis: 'free tiers; 7-day log retention' },
  ];
  const sum = (key: 'low' | 'high') => raw.reduce((total, line) => total + line[key], 0);
  return { lines: raw.map((line) => ({ item: line.item, low: usd(line.low), high: usd(line.high), basis: line.basis })), low: usd(sum('low')), high: usd(sum('high')), currency: 'USD' };
}
