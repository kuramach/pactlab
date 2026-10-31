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
};
