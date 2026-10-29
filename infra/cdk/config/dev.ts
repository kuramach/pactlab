import type { EnvironmentConfig } from './types';

export const devConfig: EnvironmentConfig = {
  name: 'dev',
  profile: 'pactlab-dev',
  // The organization's guardrail (SCP) allows CloudFormation only in us-east-2 (ADR 0003 amendment).
  region: 'us-east-2',
  protectedState: false,
  network: { maxAzs: 2, natGateways: 1 },
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
  featureFlags: { pilotMode: false, liveConnectors: false },
  // The running app (ADR 0019), sized for small and medium pacts: one task each.
  service: {
    domain: 'dev.pactlab.ai',
    web: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    api: { cpu: 512, memoryMiB: 1024, desiredCount: 1 },
    worker: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    email: { identityDomain: 'pactlab.ai', from: 'Pactlab <no-reply@pactlab.ai>' },
    malwareScanner: 'signature',
    // The app's default routes are US cross-Region inference profiles for Claude (packages/ai/src/models.ts).
    bedrock: { foundationModels: ['anthropic.claude-*'], inferenceProfiles: ['us.anthropic.claude-*'] },
    signupRequiresApproval: true,
  },
};
