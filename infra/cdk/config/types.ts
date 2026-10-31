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
  /**
   * The running application (ADR 0019): containers on Fargate behind one HTTPS
   * load balancer host. Absent: the environment has the data layer only.
   */
  readonly service?: ServiceConfig;
  /**
   * The environment's own copy of the marketing site, so the whole journey
   * (site → Sign up / Sign in → app) can be tested before live. Production's
   * site is `pactlab.ai` (PactlabSite, ADR 0003).
   */
  readonly site?: EnvironmentSiteConfig;
  /** Approved feature flags, published to SSM for the application to read. */
  readonly featureFlags: {
    /** Pilot guardrails on: invite-only organizations, no self-serve signup. */
    readonly pilotMode: boolean;
    /** Whether a deal connection may be switched to LIVE mode at all. */
    readonly liveConnectors: boolean;
  };
}

/** CPU units (1024 = 1 vCPU) and memory for one Fargate task, and how many run. */
export interface TaskSize {
  readonly cpu: 256 | 512 | 1024 | 2048;
  readonly memoryMiB: 512 | 1024 | 2048 | 4096;
  readonly desiredCount: number;
}

export interface ServiceConfig {
  /** The one public host: the web app, with `/v1/*` and `/health` routed to the API. */
  readonly domain: string;
  readonly web: TaskSize;
  readonly api: TaskSize;
  readonly worker: TaskSize;
  /** SES: the verified domain identity, and the sender used for sign-in and invitation email. */
  readonly email: { readonly identityDomain: string; readonly from: string };
  /**
   * `signature`: the built-in scanner (dev and qa only; enforced by the app's
   * config schema too). Stage and production need a managed scanner (slice 2).
   */
  readonly malwareScanner: 'signature';
  /**
   * Bedrock models the task role may call: foundation-model id patterns and
   * the matching cross-Region inference-profile patterns (the app's routes).
   */
  readonly bedrock: {
    readonly foundationModels: readonly string[];
    readonly inferenceProfiles: readonly string[];
    /**
     * Per-alias model overrides (`BEDROCK_MODEL_*`). Absent: the app's Claude
     * routes. An interim stand-in only, while Claude access is pending (ADR 0019).
     */
    readonly modelOverrides?: { readonly balanced: string; readonly deep_review: string; readonly fast: string };
  };
  /** Turn on pilot sign-up approval (`SIGNUP_REQUIRES_APPROVAL`). */
  readonly signupRequiresApproval: boolean;
}

export interface EnvironmentSiteConfig {
  /** e.g. `dev.pactlab.ai`; the app is at `app.<this domain>`. */
  readonly domain: string;
  /** `none` outside production: noindex header, robots.txt disallows everything. */
  readonly indexing: 'public' | 'none';
}
