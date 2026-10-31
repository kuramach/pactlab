import type { EnvironmentConfig } from './types';

/** Full Multi-AZ; deployed only by GitHub Actions after environment approval. */
export const prodConfig: EnvironmentConfig = {
  name: 'prod',
  profile: 'pactlab-prod',
  // The organization's guardrail (SCP) allows CloudFormation only in us-east-2 (ADR 0003 amendment).
  region: 'us-east-2',
  protectedState: true,
  // Live keeps managed NAT gateways: no single NAT instance on the path to customers (ADR 0019).
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
  evidenceNoncurrentVersionDays: 90,
  // Compliance mode: no identity, including root, can shorten or remove retention.
  auditArchive: { mode: 'COMPLIANCE', days: 2555 },
  // Design-partner pilot: LIVE connectors stay off until each adapter is verified.
  featureFlags: { pilotMode: true, liveConnectors: false },
};
