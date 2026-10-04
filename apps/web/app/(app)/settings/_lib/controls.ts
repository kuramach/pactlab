/**
 * Pilot control register: what a design partner is told about each control,
 * and where its procedure lives. Status is a claim reviewed in code review —
 * IN_PLACE only when enforced by tested code or infrastructure.
 */
export const CONTROL_STATUSES = ['IN_PLACE', 'PROCEDURE', 'GAP'] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

export const CONTROL_AREAS = [
  'Identity and access',
  'Audit and retention',
  'Data sources',
  'AI usage',
  'Release and recovery',
] as const;
export type ControlArea = (typeof CONTROL_AREAS)[number];

export interface PilotControl {
  readonly id: string;
  readonly area: ControlArea;
  readonly title: string;
  readonly status: ControlStatus;
  readonly summary: string;
  /** Repository path of the governing runbook, under docs/runbooks/. */
  readonly runbook: string;
}

export const PILOT_CONTROLS: readonly PilotControl[] = [
  {
    id: 'tenant-isolation',
    area: 'Identity and access',
    title: 'Tenant isolation',
    status: 'IN_PLACE',
    summary: 'PostgreSQL RLS on every deal row; cross-tenant allow and deny paths are tested.',
    runbook: 'docs/runbooks/suspected-cross-tenant-access.md',
  },
  {
    id: 'sso',
    area: 'Identity and access',
    title: 'Single sign-on',
    status: 'GAP',
    summary:
      'The API validates Auth0 tokens and the organization claim; per-organization SSO connections and web sign-in are not wired yet.',
    runbook: 'docs/runbooks/sso-setup.md',
  },
  {
    id: 'access-review',
    area: 'Identity and access',
    title: 'Access review',
    status: 'PROCEDURE',
    summary:
      'Monthly review of organization and deal memberships during the pilot, recorded and signed off.',
    runbook: 'docs/runbooks/access-review.md',
  },
  {
    id: 'audit-log',
    area: 'Audit and retention',
    title: 'Tamper-evident audit log',
    status: 'IN_PLACE',
    summary: 'Sensitive reads, writes and denials are appended to a per-organization hash chain.',
    runbook: 'docs/runbooks/audit-export.md',
  },
  {
    id: 'audit-export',
    area: 'Audit and retention',
    title: 'Audit export',
    status: 'GAP',
    summary:
      'Object Lock archive is provisioned per environment; the signed, tenant-scoped export endpoint is not built yet.',
    runbook: 'docs/runbooks/audit-export.md',
  },
  {
    id: 'retention',
    area: 'Audit and retention',
    title: 'Document retention',
    status: 'IN_PLACE',
    summary:
      'Uploads carry a retention class (deal term, 90 days, legal hold); legal hold blocks purge. Storage is versioned.',
    runbook: 'docs/runbooks/retention.md',
  },
  {
    id: 'vdr',
    area: 'Data sources',
    title: 'Virtual data room',
    status: 'IN_PLACE',
    summary:
      'Read-only VDR index adapter behind the connector contract, fixture mode only; live reads stay disabled until the partner API is verified.',
    runbook: 'docs/runbooks/connector-outage.md',
  },
  {
    id: 'live-connectors',
    area: 'Data sources',
    title: 'Pilot feature flags',
    status: 'PROCEDURE',
    summary:
      'Per-environment flags keep pilot mode on and LIVE connectors off in production; changes ship as reviewed config.',
    runbook: 'docs/runbooks/pilot-controls.md',
  },
  {
    id: 'scan-cleanup',
    area: 'Data sources',
    title: 'Ephemeral code scans',
    status: 'IN_PLACE',
    summary: 'Scan workspaces are destroyed on success, failure, timeout and cancellation.',
    runbook: 'docs/runbooks/failed-scan-cleanup.md',
  },
  {
    id: 'ai-metering',
    area: 'AI usage',
    title: 'Per-deal AI metering',
    status: 'GAP',
    summary:
      'The Claude gateway reports token usage per deal on every run; persisting and reporting it per deal is not built yet.',
    runbook: 'docs/runbooks/metering.md',
  },
  {
    id: 'ai-citations',
    area: 'AI usage',
    title: 'Citation enforcement',
    status: 'IN_PLACE',
    summary:
      'AI output without a resolvable citation and a human reviewer cannot become an accepted finding.',
    runbook: 'docs/runbooks/invalid-ai-citations.md',
  },
  {
    id: 'state-protection',
    area: 'Release and recovery',
    title: 'Protected production state',
    status: 'IN_PLACE',
    summary:
      'Stage and production stacks fail synthesis without termination protection, retained data stores and RDS deletion protection.',
    runbook: 'docs/runbooks/deploy.md',
  },
  {
    id: 'deploy-path',
    area: 'Release and recovery',
    title: 'Deployment path',
    status: 'PROCEDURE',
    summary: 'Stage and production deploy only through GitHub Actions after environment approval.',
    runbook: 'docs/runbooks/deploy.md',
  },
  {
    id: 'rollback',
    area: 'Release and recovery',
    title: 'Rollback',
    status: 'PROCEDURE',
    summary:
      'Application, migration, flag and infrastructure rollback paths with owners and triggers.',
    runbook: 'docs/runbooks/rollback.md',
  },
  {
    id: 'recovery-drill',
    area: 'Release and recovery',
    title: 'Recovery drill',
    status: 'PROCEDURE',
    summary: 'Restore PostgreSQL and S3 objects into an isolated environment and verify integrity.',
    runbook: 'docs/runbooks/recovery-drill.md',
  },
  {
    id: 'pentest',
    area: 'Release and recovery',
    title: 'Penetration test',
    status: 'PROCEDURE',
    summary: 'Scoped external test against stage with tenant, AI and connector abuse cases.',
    runbook: 'docs/runbooks/penetration-test-checklist.md',
  },
];

export function controlsByArea(
  controls: readonly PilotControl[] = PILOT_CONTROLS,
): { area: ControlArea; controls: PilotControl[] }[] {
  return CONTROL_AREAS.map((area) => ({
    area,
    controls: controls.filter((control) => control.area === area),
  })).filter((group) => group.controls.length > 0);
}

const STATUS_LABELS: Record<ControlStatus, string> = {
  IN_PLACE: 'in place',
  PROCEDURE: 'procedure',
  GAP: 'gap',
};

const STATUS_VARIANTS: Record<ControlStatus, 'calculation' | 'reviewed' | 'danger'> = {
  IN_PLACE: 'calculation',
  PROCEDURE: 'reviewed',
  GAP: 'danger',
};

export function statusLabel(status: ControlStatus): string {
  return STATUS_LABELS[status];
}

export function statusVariant(status: ControlStatus): 'calculation' | 'reviewed' | 'danger' {
  return STATUS_VARIANTS[status];
}

/** Open gaps block calling the pilot ready; the page states this plainly. */
export function openGaps(controls: readonly PilotControl[] = PILOT_CONTROLS): PilotControl[] {
  return controls.filter((control) => control.status === 'GAP');
}
