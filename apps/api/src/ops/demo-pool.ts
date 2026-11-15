/**
 * `scripts/ops-task.sh <env> src/ops/demo-pool.ts sweep`: the shareable demo pool (T-113,
 * ADR 0028). Five demo organizations an operator lends out from the admin console through
 * two magic links. Run every 15 minutes by a scheduled seed task, this sweep:
 *   1. creates any of the five slots that does not exist yet (to be built below);
 *   2. ends shares whose time is up (their sessions with them) and queues their slots;
 *   3. queues every idle slot built from an older demo build than this release's (T-124), so a
 *      deploy that changes what a demo contains reaches the demos without anyone running anything;
 *      a slot that is shared out keeps its data until its share ends;
 *   4. rebuilds every queued slot from the original demo data (`runDemoOrg --reset`), then
 *      makes it AVAILABLE again, or records the error and retries on the next sweep;
 *   5. rebuilds the main demo organization (`pnpm demo:live`) the same way, when it exists and is stale.
 * Synthetic only; touches only the five pool organizations. Sends no email.
 */
import 'reflect-metadata';
import type { PrismaClient } from '@pactlab/db';
import type { CompanyType } from '@pactlab/domain';
import { demoBuildVersion } from './demo-coverage';
import { DEMO_ORG, demoBuildOf, ensureDemoOrganization, githubDemoData, openDemoRuntime, runDemoOrg, type DemoDataSource, type DemoOrgSpec, type OwnerSession } from './demo-org';

export const DEMO_POOL_SIZE = 5;

/** Fixed ids per slot, so every sweep finds what is there: `…-0000000d50<slot><n>`. */
const id = (slot: number, n: number) => `01900000-0000-7000-8000-0000000d50${slot}${n.toString(16)}`;

export function demoPoolSpec(slot: number): DemoOrgSpec {
  if (!Number.isInteger(slot) || slot < 1 || slot > DEMO_POOL_SIZE) throw new Error(`No demo slot ${slot}`);
  return {
    id: id(slot, 0),
    name: `Pactlab Demo ${slot} (synthetic)`,
    slug: `pactlab-demo-${slot}`,
    // The links sign these people in; they have no address, so no code or email ever reaches them.
    buyer: { id: id(slot, 1), email: null, name: 'Demo Buyer Lead' },
    seller: { id: id(slot, 2), email: null, name: 'Demo Seller' },
    reviewer: { id: id(slot, 3), name: 'Demo Reviewer (synthetic)' },
    analyst: { id: id(slot, 4), name: 'Demo Analyst (synthetic)' },
    bidders: [
      { id: id(slot, 5), email: null, name: 'Bidder A (synthetic)', firm: 'Atlas Residential Partners (synthetic)' },
      { id: id(slot, 6), email: null, name: 'Bidder B (synthetic)', firm: 'Northline Capital (synthetic)' },
      { id: id(slot, 7), email: null, name: 'Bidder C (synthetic)', firm: 'Harbor Living Fund (synthetic)' },
    ],
  };
}

type App = Parameters<typeof runDemoOrg>[0];

/** One sweep of the pool. Returns report lines. */
export async function sweepDemoPool(app: App, owner: OwnerSession, prisma: PrismaClient, options: { types: readonly CompanyType[]; data: DemoDataSource }): Promise<string[]> {
  // One sweep at a time: the 15-minute schedule and the one a deploy starts (T-124) never rebuild the same slot twice.
  const [lock] = (await owner.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(hashtext('pactlab-demo-pool-sweep')) AS locked`)).rows;
  if (!lock?.locked) return ['another sweep is running; it does this one’s work'];
  try {
    return await sweepUnderLock(app, owner, prisma, options);
  } finally {
    await owner.query(`SELECT pg_advisory_unlock(hashtext('pactlab-demo-pool-sweep'))`);
  }
}

async function sweepUnderLock(app: App, owner: OwnerSession, prisma: PrismaClient, options: { types: readonly CompanyType[]; data: DemoDataSource }): Promise<string[]> {
  const report: string[] = [];
  // 1. Every slot exists; a new one starts RESETTING, so this sweep builds it.
  for (let slot = 1; slot <= DEMO_POOL_SIZE; slot += 1) {
    const spec = demoPoolSpec(slot);
    await ensureDemoOrganization(owner, spec);
    const created = await owner.query(
      `INSERT INTO demo_slots (organization_id, slot, buyer_user_id, seller_user_id, status) VALUES ($1, $2, $3, $4, 'RESETTING') ON CONFLICT (organization_id) DO NOTHING RETURNING slot`,
      [spec.id, slot, spec.buyer.id, spec.seller.id],
    );
    if (created.rows.length > 0) report.push(`slot ${slot}: created`);
  }
  // 2. Shares whose time is up end now, with their sessions; their slots wait for a rebuild.
  const expired = await owner.query<{ id: string; organization_id: string; shared_with: string }>(
    `UPDATE demo_shares SET ended_at = now() WHERE ended_at IS NULL AND ends_at <= now() RETURNING id, organization_id, shared_with`,
  );
  for (const share of expired.rows) {
    await owner.query(`UPDATE auth_sessions SET revoked_at = now() WHERE demo_share_id = $1 AND revoked_at IS NULL`, [share.id]);
    await owner.query(`UPDATE demo_slots SET status = 'RESETTING', updated_at = now() WHERE organization_id = $1`, [share.organization_id]);
    await owner.query(
      `INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome) VALUES (uuidv7(), $1, NULL, NULL, 'demo.expired', 'demo_share', $2, 'SUCCEEDED')`,
      [share.organization_id, share.id],
    );
    report.push(`share for ${share.shared_with}: ended (time up)`);
  }
  // 3. Idle slots from an older demo build are rebuilt now; shared ones wait for their share to end.
  const current = demoBuildVersion(options.types);
  const idle = await owner.query<{ organization_id: string; slot: number }>(`SELECT organization_id, slot FROM demo_slots WHERE status = 'AVAILABLE' ORDER BY slot`);
  for (const row of idle.rows) {
    if ((await demoBuildOf(owner, row.organization_id)) === current) continue;
    await owner.query(`UPDATE demo_slots SET status = 'RESETTING', updated_at = now() WHERE organization_id = $1 AND status = 'AVAILABLE'`, [row.organization_id]);
    report.push(`slot ${row.slot}: built from an older release; rebuilding`);
  }
  // 4. Rebuild every queued slot from the original demo data.
  const queued = await owner.query<{ organization_id: string; slot: number }>(`SELECT organization_id, slot FROM demo_slots WHERE status = 'RESETTING' ORDER BY slot`);
  for (const row of queued.rows) {
    const spec = demoPoolSpec(Number(row.slot));
    // Nobody stays signed in to a slot being rebuilt.
    await owner.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL`, [[spec.buyer.id, spec.seller.id, ...spec.bidders.map((bidder) => bidder.id)]]);
    try {
      const lines = await runDemoOrg(app, owner, prisma, { types: options.types, reset: true, data: options.data, spec });
      const failed = lines.filter((line) => line.includes('FAILED'));
      if (failed.length > 0) throw new Error(failed.join(' | ').slice(0, 1900));
      await owner.query(`UPDATE demo_slots SET status = 'AVAILABLE', reset_at = now(), last_error = NULL, updated_at = now() WHERE organization_id = $1`, [spec.id]);
      report.push(`slot ${row.slot}: rebuilt and available`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await owner.query(`UPDATE demo_slots SET last_error = $2, updated_at = now() WHERE organization_id = $1`, [spec.id, message.slice(0, 2000)]);
      report.push(`slot ${row.slot}: FAILED (${message.slice(0, 300)}); retried on the next sweep`);
    }
  }
  // 5. The main demo organization, when it exists and is stale (never created here: that is `pnpm demo:live`).
  const main = await owner.query<{ id: string }>(`SELECT o.id FROM organizations o WHERE o.id = $1 AND EXISTS (SELECT 1 FROM deals d WHERE d.organization_id = o.id)`, [DEMO_ORG.id]);
  if (main.rows.length > 0 && (await demoBuildOf(owner, DEMO_ORG.id)) !== current) {
    try {
      const lines = await runDemoOrg(app, owner, prisma, { types: options.types, reset: true, data: options.data, spec: DEMO_ORG });
      const failed = lines.filter((line) => line.includes('FAILED'));
      report.push(failed.length > 0 ? `demo organization: rebuilt with problems (${failed.join(' | ').slice(0, 300)}); retried on the next sweep` : 'demo organization: built from an older release; rebuilt');
    } catch (error) {
      report.push(`demo organization: FAILED (${(error instanceof Error ? error.message : 'unknown error').slice(0, 300)}); retried on the next sweep`);
    }
  }
  if (report.length === 0) report.push('nothing to do');
  return report;
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'sweep') throw new Error('Usage: demo-pool.ts sweep');
  const runtime = await openDemoRuntime();
  let report: string[];
  try {
    report = await sweepDemoPool(runtime.app, runtime.owner, runtime.prisma, { types: runtime.types, data: githubDemoData });
  } finally {
    await runtime.close();
  }
  process.stdout.write(`Demo pool (${runtime.environment}):\n${report.map((line) => ` - ${line}`).join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
