import type { EnvironmentConfig } from './types';

/**
 * Skinny profile (interim — T-070 sizing decision 2026-10-22; T-102 step 1, 2026-11-05): qa-class
 * sizing until the packs are complete and customers arrive. Everything protective stays
 * production's: termination protection, deletion protection, 35-day backups, COMPLIANCE audit
 * archive, pilot guardrails.
 *
 * Scaled target — restore as one config flip when live carries real load: network maxAzs 3 with
 * 3 NAT gateways, RDS m7g.large Multi-AZ (100 GiB), Redis cache.m7g.large x2.
 *
 * Deployed only by GitHub Actions after environment approval.
 */
export const prodConfig: EnvironmentConfig = {
  name: 'prod',
  profile: 'pactlab-prod',
  // The organization's guardrail (SCP) allows CloudFormation only in us-east-2 (ADR 0003 amendment).
  region: 'us-east-2',
  protectedState: true,
  // Live keeps a managed NAT gateway, never a NAT instance; the skinny profile runs one (ADR 0019).
  network: { maxAzs: 2, natGateways: 1, nat: 'gateway' },
  database: {
    instanceClass: 't4g',
    instanceSize: 'medium',
    multiAz: false,
    allocatedStorageGiB: 20,
    maxAllocatedStorageGiB: 100,
    backupRetentionDays: 35,
  },
  redis: { nodeType: 'cache.t4g.micro', numCacheClusters: 1, snapshotRetentionDays: 7 },
  evidenceNoncurrentVersionDays: 90,
  // Compliance mode: no identity, including root, can shorten or remove retention.
  auditArchive: { mode: 'COMPLIANCE', days: 2555 },
  // Design-partner pilot: LIVE connectors stay off until each adapter is verified.
  featureFlags: { pilotMode: true, liveConnectors: false },
};
