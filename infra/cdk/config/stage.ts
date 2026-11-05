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
    instanceSize: 'large',
    multiAz: true,
    allocatedStorageGiB: 50,
    maxAllocatedStorageGiB: 200,
    backupRetentionDays: 14,
  },
  redis: { nodeType: 'cache.t4g.small', numCacheClusters: 2, snapshotRetentionDays: 1 },
  evidenceNoncurrentVersionDays: 30,
  auditArchive: { mode: 'GOVERNANCE', days: 30 },
  // Stage runs read-only vendor-sandbox dry runs before production promotion.
  // Only production runs all the time: this environment pauses after an hour without use.
  idlePause: { idleMinutes: 60 },
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
      foundationModels: ['anthropic.claude-*'],
      inferenceProfiles: ['us.anthropic.claude-*'],
      modelOverrides: { balanced: 'us.anthropic.claude-sonnet-4-6', deep_review: 'us.anthropic.claude-opus-4-6-v1', fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
    },
    // Like live: a new organization waits for approval.
    signupRequiresApproval: true,
    // Like live: start new before stopping old, 30-second health checks, and CloudFormation moves the worker.
    rollout: 'careful',
  },
  site: { domain: 'stage.pactlab.ai', indexing: 'none' },
};
