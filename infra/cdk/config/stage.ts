import type { EnvironmentConfig } from './types';

/** Production shape at reduced capacity; deployed only by GitHub Actions. */
export const stageConfig: EnvironmentConfig = {
  name: 'stage',
  profile: 'pactlab-stage',
  // The organization's guardrail (SCP) allows CloudFormation only in us-east-2 (ADR 0003 amendment).
  region: 'us-east-2',
  protectedState: true,
  // Stage keeps its own network, load balancer and Redis, shaped like live, but with a NAT instance (ADR 0019).
  network: { maxAzs: 2, natGateways: 1, nat: 'instance' },
  database: {
    instanceClass: 't4g',
    // live's own size (ADR 0063): stage is live's rehearsal and carries less load. Storage stays at 50 GiB:
    // RDS can't shrink allocated storage, or restore a snapshot into less.
    instanceSize: 'medium',
    multiAz: false,
    allocatedStorageGiB: 50,
    maxAllocatedStorageGiB: 200,
    backupRetentionDays: 3,
  },
  // One node (ADR 0063): the queues are rebuildable; a lost node means a restart, not lost data.
  redis: { nodeType: 'cache.t4g.small', numCacheClusters: 1, snapshotRetentionDays: 1 },
  evidenceNoncurrentVersionDays: 30,
  auditArchive: { mode: 'GOVERNANCE', days: 30 },
  // Stage runs read-only vendor-sandbox dry runs before production promotion.
  // Only production runs all the time: this environment pauses after an hour without use.
  idlePause: { idleMinutes: 60 },
  // Then, after 3 hours without use, hibernate: snapshot, delete what bills by the hour, rebuild on demand (ADR 0063).
  hibernate: { idleHours: 3, snapshotsKept: 2 },
  // Pre-production log triage (T-157): verdicts like live (stage Bedrock verified 2026-11-20).
  // Dry run until Kumar approves the dry-run digest.
  logTriage: {
    environments: ['stage'],
    recipient: 'kumar@pactlab.ai',
    githubRepo: 'kuramach/pactlab',
    githubTokenSecretName: 'pactlab/stage/github-triage',
    // The account's default Claude route (the API's `balanced`).
    modelId: 'us.anthropic.claude-sonnet-5-5',
    dryRun: true,
    hourUtc: 13,
    maxClusters: 10,
  },
  featureFlags: { pilotMode: true, liveConnectors: true },
  // Customer testing before live (ADR 0019): live's behaviour on its own account, at the skinny tier.
  // Customers may test with real documents here, so stage is protected like live and never shares
  // infrastructure or data with dev or qa.
  service: {
    domain: 'app.stage.pactlab.ai',
    web: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    api: { cpu: 512, memoryMiB: 1024, desiredCount: 1 },
    worker: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    // Its own SES identity for pactlab.ai in the stage account (DKIM records added once, at the registrar).
    email: { identityDomain: 'pactlab.ai', from: 'Pactlab <no-reply@pactlab.ai>' },
    malwareScanner: 'signature',
    // Claude model access is per AWS account: stage needs its own Anthropic access, like dev's. Until AWS
    // enables the app's 5.5 defaults there, the same models as dev and qa.
    bedrock: {
      // Any Bedrock model may be chosen in Admin → AI models (Kumar, 2026-11-20: "All Bedrock models"); data stays in the account.
      foundationModels: ['*'],
      inferenceProfiles: ['*'],
      modelOverrides: { balanced: 'us.anthropic.claude-sonnet-5-5', deep_review: 'us.anthropic.claude-opus-5-5', fast: 'us.anthropic.claude-haiku-5-5' },
    },
    // Pactlab signing (T-136): BoldSign once its sandbox key is set (scripts/signing-key.sh), test signing until then.
    signing: { providers: ['boldsign', 'fixture'] },
    // Like live: a new organization waits for approval.
    signupRequiresApproval: true,
    // Emailed on every sign-up waiting for approval, so nobody waits unnoticed (Kumar, 2026-11-05).
    operatorEmail: 'kumar@pactlab.ai',
    // Like live: start new before stopping old, 30-second health checks, and CloudFormation moves the worker.
    rollout: 'careful',
  },
  site: { domain: 'stage.pactlab.ai', indexing: 'none' },
};
