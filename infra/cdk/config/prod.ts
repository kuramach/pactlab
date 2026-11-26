import type { EnvironmentConfig } from './types';

/**
 * The full production profile, kept for when live outgrows the skinny tier: Multi-AZ
 * m7g database, three AZs with a NAT gateway each, an m7g Redis pair. Scaling up is
 * spreading these over `prodConfig` — one change, no re-architecture (T-070).
 */
export const PROD_SCALED_TARGET = {
  network: { maxAzs: 3, natGateways: 3, nat: 'gateway' },
  database: {
    instanceClass: 'm7g',
    instanceSize: 'large',
    multiAz: true,
    allocatedStorageGiB: 100,
    maxAllocatedStorageGiB: 1000,
    backupRetentionDays: 35,
  },
  redis: { nodeType: 'cache.m7g.large', numCacheClusters: 2, snapshotRetentionDays: 7 },
} as const satisfies Pick<EnvironmentConfig, 'network' | 'database' | 'redis'>;

/**
 * Live (GitHub Environment `live`, CDK name `prod`): skinny for small and medium pacts
 * (Kumar, 2026-11-05), about $150–180 a month — single-AZ t4g database, one managed NAT
 * gateway, micro Redis — with production's protections kept: protected state, 35-day
 * backups, deletion protection, the COMPLIANCE audit archive. Always on (no idle pause),
 * never shared, deployed only from main after approval.
 */
export const prodConfig: EnvironmentConfig = {
  name: 'prod',
  profile: 'pactlab-prod',
  // The organization's guardrail (SCP) allows CloudFormation only in us-east-2 (ADR 0003 amendment).
  region: 'us-east-2',
  protectedState: true,
  // A managed NAT gateway, not an instance: no hand-run NAT on the path to customers (ADR 0019). One, while skinny.
  network: { maxAzs: 2, natGateways: 1, nat: 'gateway' },
  database: {
    instanceClass: 't4g',
    instanceSize: 'medium',
    multiAz: false,
    allocatedStorageGiB: 20,
    maxAllocatedStorageGiB: 200,
    backupRetentionDays: 35,
  },
  redis: { nodeType: 'cache.t4g.micro', numCacheClusters: 1, snapshotRetentionDays: 7 },
  evidenceNoncurrentVersionDays: 90,
  // Compliance mode: no identity, including root, can shorten or remove retention.
  auditArchive: { mode: 'COMPLIANCE', days: 2555 },
  // Live log triage (T-150): dry run until Kumar approves the draft digest; then `dryRun: false` and deploy.
  logTriage: {
    recipient: 'kumar@pactlab.ai',
    githubRepo: 'kuramach/pactlab',
    githubTokenSecretName: 'pactlab/live/github-triage',
    // The account's default Claude route (the API's `balanced`).
    modelId: 'us.anthropic.claude-sonnet-5-5',
    dryRun: true,
    // 07:00 Chicago in winter.
    hourUtc: 13,
    maxClusters: 20,
  },
  // Design-partner pilot: LIVE connectors stay off until each adapter is verified.
  featureFlags: { pilotMode: true, liveConnectors: false },
  // The live app. The live site (pactlab.ai) is its own stack and workflow (site.yml), not part of this one.
  service: {
    domain: 'app.pactlab.ai',
    web: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    api: { cpu: 512, memoryMiB: 1024, desiredCount: 1 },
    worker: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    // Its own SES identity for pactlab.ai, with MAIL FROM mail.pactlab.ai (the DNS already in place covers it).
    email: { identityDomain: 'pactlab.ai', from: 'Pactlab <no-reply@pactlab.ai>' },
    // ACCEPTED RISK (Kumar, 2026-11-05): the signature scanner until the managed one lands (T-103).
    malwareScanner: 'signature',
    // Claude access is per account; until AWS enables the app's 5.5 defaults here, the same models as the others.
    bedrock: {
      // Any Bedrock model may be chosen in Admin → AI models (Kumar, 2026-11-20: "All Bedrock models"); data stays in the account.
      foundationModels: ['*'],
      inferenceProfiles: ['*'],
      modelOverrides: { balanced: 'us.anthropic.claude-sonnet-5-5', deep_review: 'us.anthropic.claude-opus-5-5', fast: 'us.anthropic.claude-haiku-5-5' },
    },
    // Pactlab signing (T-136): BoldSign's SANDBOX account until the production go; envelopes go to test recipients only.
    signing: { providers: ['boldsign'] },
    // A new organization waits for an operator's approval.
    signupRequiresApproval: true,
    // Emailed on every sign-up waiting for approval, so nobody waits unnoticed (Kumar, 2026-11-05).
    operatorEmail: 'kumar@pactlab.ai',
    // Start new before stopping old, 30-second health checks; CloudFormation moves the worker.
    rollout: 'careful',
  },
};
