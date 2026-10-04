import type { EnvironmentConfig } from './types';

/** Production shape at reduced capacity; deployed only by GitHub Actions. */
export const stageConfig: EnvironmentConfig = {
  name: 'stage',
  profile: 'pactlab-stage',
  region: 'us-east-1',
  protectedState: true,
  network: { maxAzs: 2, natGateways: 2 },
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
  featureFlags: { pilotMode: true, liveConnectors: true },
};
