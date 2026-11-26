import type { EnvironmentConfig } from './types';

export const devConfig: EnvironmentConfig = {
  name: 'dev',
  profile: 'pactlab-dev',
  // The organization's guardrail (SCP) allows CloudFormation only in us-east-2 (ADR 0003 amendment).
  region: 'us-east-2',
  protectedState: false,
  network: { maxAzs: 2, natGateways: 1 },
  // dev and qa share one network, NAT instance, load balancer and Redis (ADR 0019); dev uses Redis database 0.
  shared: { base: 'nonlive', redisDb: 0, rulePriorityBase: 100 },
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
  // Pre-production log triage (T-157): this account's one deployment sweeps dev AND qa (separate log groups,
  // state, labels and digest sections). Cluster-only: Bedrock access is not enabled in this account yet, so no
  // model is named and no model call is made. The flip, once it is: modelId 'us.anthropic.claude-sonnet-5-5'.
  // Dry run until Kumar approves the dry-run digest.
  logTriage: {
    environments: ['dev', 'qa'],
    recipient: 'kumar@pactlab.ai',
    githubRepo: 'kuramach/pactlab',
    githubTokenSecretName: 'pactlab/dev/github-triage',
    dryRun: true,
    // 07:00 Chicago in winter, as live.
    hourUtc: 13,
    maxClusters: 10,
  },
  featureFlags: { pilotMode: false, liveConnectors: false },
  // The running app (ADR 0019), sized for small and medium pacts: one task each.
  service: {
    // Same shape as production: site at <env>.pactlab.ai, app at app.<env>.pactlab.ai.
    domain: 'app.dev.pactlab.ai',
    web: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    api: { cpu: 512, memoryMiB: 1024, desiredCount: 1 },
    worker: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    email: { identityDomain: 'pactlab.ai', from: 'Pactlab <no-reply@pactlab.ai>' },
    malwareScanner: 'signature',
    // The app's default routes are the Claude 5.5 models (packages/ai/src/models.ts), which AWS has not yet
    // enabled for this account (2026-11-02; neither the Claude 5 family nor Opus 4.7/4.8 are). Until it does,
    // the newest Claude models it can call. Remove `modelOverrides` once the defaults answer `pnpm ai:check`.
    bedrock: {
      // Any Bedrock model may be chosen in Admin → AI models (Kumar, 2026-11-20: "All Bedrock models"); data stays in the account.
      foundationModels: ['*'],
      inferenceProfiles: ['*'],
      modelOverrides: { balanced: 'us.anthropic.claude-sonnet-5-5', deep_review: 'us.anthropic.claude-opus-5-5', fast: 'us.anthropic.claude-haiku-5-5' },
    },
    // Pactlab signing (T-136): BoldSign once its sandbox key is set (scripts/signing-key.sh), test signing until then.
    signing: { providers: ['boldsign', 'fixture'] },
    // Dev and qa: new organizations are active at once, so sign-up can be tested end to end.
    signupRequiresApproval: false,
    // Quick releases here; stage and live keep AWS's slower, more cautious checks.
    rollout: 'fast',
  },
  site: { domain: 'dev.pactlab.ai', indexing: 'none' },
};
