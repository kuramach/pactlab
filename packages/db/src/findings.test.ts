import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type Finding, type FindingReview, type TenantContext } from '@pactlab/domain';
import { findings } from './findings';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';

const SHA = 'a'.repeat(40);

/** Seed one evidence item for a tenant as the schema owner (synthetic data). */
async function seedEvidence(db: TestDatabase, tenant: SyntheticTenant): Promise<string> {
  const connectionId = newId();
  const syncRunId = newId();
  const evidenceId = newId();
  await db.owner.query(
    `INSERT INTO connections (id, organization_id, deal_id, provider, display_name, mode, config, created_by, updated_at)
     VALUES ($1, $2, $3, 'github', 'Repo', 'FIXTURE', '{}', $4, now())`,
    [connectionId, tenant.organizationId, tenant.dealId, tenant.userId],
  );
  await db.owner.query(
    `INSERT INTO sync_runs (id, organization_id, deal_id, connection_id, connector_version, idempotency_key, requested_by, correlation_id)
     VALUES ($1, $2, $3, $4, 'v1', $5, $6, 'test')`,
    [syncRunId, tenant.organizationId, tenant.dealId, connectionId, `sync-${syncRunId}`, tenant.userId],
  );
  await db.owner.query(
    `INSERT INTO evidence_items (id, organization_id, deal_id, connection_id, first_sync_run_id, last_sync_run_id,
       evidence_type, source_system, source_record_id, canonical, content_hash)
     VALUES ($1, $2, $3, $4, $5, $5, 'code.commit', 'github', 'c-1', '{}', $6)`,
    [evidenceId, tenant.organizationId, tenant.dealId, connectionId, syncRunId, '0'.repeat(64)],
  );
  return evidenceId;
}

function draft(tenant: SyntheticTenant, evidenceItemId: string, overrides: Partial<Finding> = {}): Finding {
  const now = new Date().toISOString();
  return {
    id: newId(),
    organizationId: tenant.organizationId,
    dealId: tenant.dealId,
    domain: 'SECURITY',
    title: 'Dynamic evaluation',
    description: 'Evaluates runtime input.',
    severity: 'HIGH',
    confidence: 'HIGH',
    status: 'DRAFT',
    origin: 'HUMAN',
    fingerprint: `human:${newId()}`,
    evidence: [
      {
        evidenceItemId,
        commitSha: SHA,
        toolName: 'semgrep',
        toolVersion: '1.0.0',
        rulesetVersion: null,
        path: 'src/rules.ts',
        lineStart: 3,
        lineEnd: 4,
      },
    ],
    pricedRisk: { type: 'ESCROW', currency: 'USD', low: '10.5', high: '20', basis: 'Estimate' },
    createdBy: { kind: 'HUMAN', userId: tenant.userId, role: 'DEAL_LEAD' },
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

describe('findings persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let evidenceA: string;
  let evidenceB: string;
  let contributor: TenantContext;

  const inTenant = <T>(context: TenantContext, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(db.prisma, context, fn);

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    evidenceA = await seedEvidence(db, a);
    evidenceB = await seedEvidence(db, b);
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('round-trips a finding with exact decimal money and provenance', async () => {
    const finding = draft(a, evidenceA);
    await inTenant(a.context, (tx) => findings.insert(tx, finding));
    const stored = await inTenant(a.context, (tx) => findings.get(tx, a.dealId, finding.id));
    expect(stored?.finding).toMatchObject({
      status: 'DRAFT',
      version: 1,
      evidence: finding.evidence,
      pricedRisk: { type: 'ESCROW', currency: 'USD', low: '10.5', high: '20', basis: 'Estimate' },
      createdBy: finding.createdBy,
    });
    expect(stored?.reviews).toEqual([]);
  });

  it('isolates tenants and hides findings from target contributors at the database', async () => {
    const finding = draft(a, evidenceA);
    await inTenant(a.context, (tx) => findings.insert(tx, finding));
    expect(await inTenant(b.context, (tx) => tx.finding.count())).toBe(0);
    expect(await inTenant(b.context, (tx) => findings.get(tx, a.dealId, finding.id))).toBeNull();
    expect(await inTenant(contributor, (tx) => tx.finding.count())).toBe(0);
    expect(await inTenant(contributor, (tx) => tx.findingEvidenceLink.count())).toBe(0);
    // Writes into another tenant's deal fail the policy check.
    await expect(inTenant(b.context, (tx) => findings.insert(tx, draft(a, evidenceA)))).rejects.toThrow();
    await expect(inTenant(contributor, (tx) => findings.insert(tx, draft(a, evidenceA)))).rejects.toThrow();
  });

  it('rejects evidence links that point at another tenant', async () => {
    await expect(inTenant(a.context, (tx) => findings.insert(tx, draft(a, evidenceB)))).rejects.toThrow();
  });

  it('is idempotent by fingerprint', async () => {
    const finding = draft(a, evidenceA, { fingerprint: 'scan:fixed' });
    await inTenant(a.context, (tx) => findings.insert(tx, finding));
    await expect(
      inTenant(a.context, (tx) => findings.insert(tx, { ...finding, id: newId() })),
    ).rejects.toThrow();
    expect((await inTenant(a.context, (tx) => findings.findByFingerprint(tx, a.dealId, 'scan:fixed')))?.id).toBe(
      finding.id,
    );
  });

  it('applies optimistic concurrency and keeps evidence history append-only', async () => {
    const finding = draft(a, evidenceA);
    await inTenant(a.context, (tx) => findings.insert(tx, finding));
    const edited: Finding = {
      ...finding,
      evidence: [{ ...finding.evidence[0]!, lineStart: 9, lineEnd: 9 }],
      version: 2,
    };
    expect(await inTenant(a.context, (tx) => findings.update(tx, edited, 1, null))).toBe(true);
    expect(await inTenant(a.context, (tx) => findings.update(tx, { ...edited, version: 3 }, 1, null))).toBe(false);

    const review: FindingReview = {
      id: newId(),
      findingId: finding.id,
      decision: 'SUBMITTED',
      fromStatus: 'DRAFT',
      toStatus: 'IN_REVIEW',
      reviewerUserId: a.userId,
      reviewerRole: 'DEAL_LEAD',
      rationale: 'Ready',
      decidedAt: new Date().toISOString(),
    };
    expect(
      await inTenant(a.context, (tx) => findings.update(tx, { ...edited, status: 'IN_REVIEW', version: 3 }, 2, review)),
    ).toBe(true);

    const stored = await inTenant(a.context, (tx) => findings.get(tx, a.dealId, finding.id));
    expect(stored?.finding).toMatchObject({ status: 'IN_REVIEW', version: 3 });
    expect(stored?.finding.evidence.map((link) => link.lineStart)).toEqual([9]);
    expect(stored?.reviews.map((r) => r.decision)).toEqual(['SUBMITTED']);
    const history = (await db.owner.query(
      `SELECT finding_version FROM finding_evidence_links WHERE finding_id = $1 ORDER BY finding_version`,
      [finding.id],
    )) as { rows: { finding_version: number }[] };
    expect(history.rows.map((row) => row.finding_version)).toEqual([1, 2]);
  });

  it('denies reviews recorded in another user’s name', async () => {
    const finding = draft(a, evidenceA);
    await inTenant(a.context, (tx) => findings.insert(tx, finding));
    const forged: FindingReview = {
      id: newId(),
      findingId: finding.id,
      decision: 'SUBMITTED',
      fromStatus: 'DRAFT',
      toStatus: 'IN_REVIEW',
      reviewerUserId: newId(),
      reviewerRole: 'DEAL_LEAD',
      rationale: 'x',
      decidedAt: new Date().toISOString(),
    };
    await expect(
      inTenant(a.context, (tx) => findings.update(tx, { ...finding, status: 'IN_REVIEW', version: 2 }, 1, forged)),
    ).rejects.toThrow();
  });

  it('grants no DELETE and keeps reviews and links immutable', async () => {
    const statements = [
      `DELETE FROM findings`,
      `DELETE FROM finding_reviews`,
      `DELETE FROM finding_evidence_links`,
      `UPDATE finding_reviews SET rationale = 'x'`,
      `UPDATE finding_evidence_links SET tool_version = 'x'`,
      `UPDATE findings SET origin = 'AI'`,
      `UPDATE findings SET fingerprint = 'x'`,
    ];
    for (const sql of statements) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('rejects malformed money and provenance at the database', async () => {
    await expect(
      inTenant(a.context, (tx) =>
        findings.insert(tx, draft(a, evidenceA, { pricedRisk: { type: 'ESCROW', currency: 'USD', low: '5', high: '1', basis: 'x' } })),
      ),
    ).rejects.toThrow();
    const bad = draft(a, evidenceA);
    await expect(
      inTenant(a.context, (tx) =>
        findings.insert(tx, { ...bad, evidence: [{ ...bad.evidence[0]!, commitSha: 'main' }] }),
      ),
    ).rejects.toThrow();
    await expect(
      inTenant(a.context, (tx) =>
        findings.insert(tx, { ...bad, id: newId(), fingerprint: newId(), evidence: [{ ...bad.evidence[0]!, path: '../etc' }] }),
      ),
    ).rejects.toThrow();
  });
});
