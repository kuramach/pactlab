import type { EnvironmentConfig } from './types';

/** Resettable and seeded with HealthyCo, TroubledCo and SparseCo. */
export const qaConfig: EnvironmentConfig = {
  name: 'qa',
  profile: 'pactlab-qa',
  region: 'us-east-1',
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
  featureFlags: { pilotMode: true, liveConnectors: false },
};
