export const ENVIRONMENT_NAMES = ['dev', 'qa', 'stage', 'prod'] as const;
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

/**
 * Everything that differs between environments. Differences are data, not
 * forks of the infrastructure code. Account IDs are never committed: they are
 * supplied as CDK context (`pactlab:<env>:account`) by the deploy workflow.
 */
export interface EnvironmentConfig {
  readonly name: EnvironmentName;
  /** The one AWS CLI profile allowed to target this environment. */
  readonly profile: `pactlab-${EnvironmentName}`;
  readonly region: string;
  /**
   * Stage and production: stack termination protection, RETAIN on every
   * stateful resource and RDS deletion protection. Enforced by
   * StatefulProtectionAspect, which fails synthesis when any is missing.
   */
  readonly protectedState: boolean;
  readonly network: { readonly maxAzs: number; readonly natGateways: number };
  readonly database: {
    readonly instanceClass: 't4g' | 'm7g' | 'r7g';
    readonly instanceSize: 'medium' | 'large' | 'xlarge';
    readonly multiAz: boolean;
    readonly allocatedStorageGiB: number;
    readonly maxAllocatedStorageGiB: number;
    readonly backupRetentionDays: number;
  };
  readonly redis: {
    readonly nodeType: string;
    readonly numCacheClusters: number;
    readonly snapshotRetentionDays: number;
  };
  /** Days a noncurrent evidence object version is kept before expiry. */
  readonly evidenceNoncurrentVersionDays: number;
  /** Object Lock default retention for exported audit archives. */
  readonly auditArchive: { readonly mode: 'GOVERNANCE' | 'COMPLIANCE'; readonly days: number };
  /** Approved feature flags, published to SSM for the application to read. */
  readonly featureFlags: {
    /** Pilot guardrails on: invite-only organizations, no self-serve signup. */
    readonly pilotMode: boolean;
    /** Whether a deal connection may be switched to LIVE mode at all. */
    readonly liveConnectors: boolean;
  };
}
