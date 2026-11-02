import type { EnvironmentConfig } from './types';

/** Resettable and seeded with HealthyCo, TroubledCo and SparseCo. */
export const qaConfig: EnvironmentConfig = {
  name: 'qa',
  profile: 'pactlab-qa',
  // The organization's guardrail (SCP) allows CloudFormation only in us-east-2 (ADR 0003 amendment).
  region: 'us-east-2',
  protectedState: false,
  network: { maxAzs: 2, natGateways: 1 },
  // dev and qa share one network, NAT instance, load balancer and Redis (ADR 0019); qa uses Redis database 1.
  shared: { base: 'nonlive', redisDb: 1, rulePriorityBase: 200 },
  database: {
    instanceClass: 't4g',
    instanceSize: 'medium',
    multiAz: false,
    allocatedStorageGiB: 20,
    maxAllocatedStorageGiB: 100,
    backupRetentionDays: 7,
  },
  redis: { nodeType: 'cache.t4g.micro', numCacheClusters: 1, snapshotRetentionDays: 0 },
  evidenceNoncurrentVersionDays: 7,
  auditArchive: { mode: 'GOVERNANCE', days: 1 },
  // Only production runs all the time: this environment pauses after an hour without use.
  idlePause: { idleMinutes: 60 },
  featureFlags: { pilotMode: true, liveConnectors: false },
  // Same shape as dev and live: site at qa.pactlab.ai, app at app.qa.pactlab.ai, on the shared non-live base.
  service: {
    domain: 'app.qa.pactlab.ai',
    web: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    api: { cpu: 512, memoryMiB: 1024, desiredCount: 1 },
    worker: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    // dev's stack holds the pactlab.ai SES identity in this account; qa sends as it.
    email: { identityDomain: 'pactlab.ai', from: 'Pactlab <no-reply@pactlab.ai>', identityOwner: false },
    malwareScanner: 'signature',
    // The app's default routes are the Claude 5.5 models (packages/ai/src/models.ts), which AWS has not yet
    // enabled for this account (2026-11-02; neither the Claude 5 family nor Opus 4.7/4.8 are). Until it does,
    // the newest Claude models it can call. Remove `modelOverrides` once the defaults answer `pnpm ai:check`.
    bedrock: {
      foundationModels: ['anthropic.claude-*'],
      inferenceProfiles: ['us.anthropic.claude-*'],
      modelOverrides: { balanced: 'us.anthropic.claude-sonnet-4-6', deep_review: 'us.anthropic.claude-opus-4-6-v1', fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
    },
    // Dev and qa: new organizations are active at once, so sign-up can be tested end to end.
    signupRequiresApproval: false,
    // Quick releases here; stage and live keep AWS's slower, more cautious checks.
    rollout: 'fast',
  },
  site: { domain: 'qa.pactlab.ai', indexing: 'none' },
};
