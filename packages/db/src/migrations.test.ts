import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const migrations = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sql = (name: string) => readFileSync(join(DIR, name, 'migration.sql'), 'utf8');

/**
 * Deployed databases migrate as the schema owner, not a superuser, so FORCE ROW LEVEL SECURITY
 * applies to the migration too: a backfill on a forced table silently changes nothing unless the
 * file lifts it first. Tests run as a superuser and never see it (live, 2026-11-14).
 */
describe('migrations', () => {
  it('lift FORCE ROW LEVEL SECURITY before changing rows of a forced table', () => {
    // Already applied, accepted: 8-hour sessions from before trusted devices, long expired.
    const accepted = new Set(['20261202000000_trusted_sessions:auth_sessions']);
    const forced = new Set<string>();
    const offenders: string[] = [];
    for (const name of migrations) {
      // Function bodies run later, as their owner: only top-level statements matter here.
      const body = sql(name).replace(/\$\$[\s\S]*?\$\$/g, '').replace(/--[^\n]*/g, '');
      const lifted = new Set<string>();
      for (const statement of body.split(';').map((part) => part.replace(/\s+/g, ' ').trim())) {
        const lift = /^ALTER TABLE "?(\w+)"? NO FORCE ROW LEVEL SECURITY$/i.exec(statement);
        if (lift?.[1]) lifted.add(lift[1]);
        const change = /^(?:WITH [\s\S]+? )?(?:UPDATE|DELETE FROM|INSERT INTO) "?(\w+)"?/i.exec(statement);
        if (change?.[1] && forced.has(change[1]) && !lifted.has(change[1]) && !accepted.has(`${name}:${change[1]}`)) offenders.push(`${name}: ${statement.slice(0, 80)}`);
        const force = /^ALTER TABLE "?(\w+)"? FORCE ROW LEVEL SECURITY$/i.exec(statement);
        if (force?.[1]) {
          forced.add(force[1]);
          lifted.delete(force[1]);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('apply over finished report versions: the IC backfill marks the own side and numbers each series (T-118)', async () => {
    const db = await PGlite.create();
    const ic = migrations.indexOf('20261204000000_investment_committee');
    for (const name of migrations.slice(0, ic)) await db.exec(sql(name));
    const [org, lead, seller, deal] = ['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000004'];
    await db.exec(`
      INSERT INTO organizations (id, name, slug, auth0_organization_id, updated_at) VALUES ('${org}', 'Org', 'org-backfill', 'org_backfill', now());
      INSERT INTO users (id, auth0_subject, display_name) VALUES ('${lead}', 's|1', 'Lead'), ('${seller}', 's|2', 'Seller');
      INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at) VALUES ('${deal}', '${org}', 'D', 'T', 'PRIVATE_ACQUIRER', '${lead}', now());
      INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES (gen_random_uuid(), '${org}', '${deal}', '${lead}', 'DEAL_LEAD'), (gen_random_uuid(), '${org}', '${deal}', '${seller}', 'TARGET_CONTRIBUTOR');
      INSERT INTO report_versions (id, organization_id, scope, deal_id, version, status, generated_by, generated_at, data_as_of, captured) VALUES
        (gen_random_uuid(), '${org}', 'PACT', '${deal}', 1, 'FAILED', '${lead}', now(), now(), '{}'),
        (gen_random_uuid(), '${org}', 'PACT', '${deal}', 2, 'FAILED', '${seller}', now(), now(), '{}'),
        (gen_random_uuid(), '${org}', 'EXECUTIVE', NULL, 1, 'FAILED', '${lead}', now(), now(), '{}');
    `);
    // Before the fix this failed: the immutability trigger refused to touch finished versions.
    for (const name of migrations.slice(ic)) await db.exec(sql(name));
    const rows = await db.query<{ scope: string; version: number; own_side: boolean; series: string }>('SELECT scope, version, own_side, series FROM report_versions ORDER BY scope, version');
    expect(rows.rows).toEqual([
      { scope: 'EXECUTIVE', version: 1, own_side: false, series: lead },
      { scope: 'PACT', version: 1, own_side: true, series: '00000000-0000-0000-0000-000000000000' },
      { scope: 'PACT', version: 2, own_side: false, series: seller },
    ]);
    // And everything lifted is back: the table is forced again, and finished versions are final again.
    const forced = await db.query<{ relname: string; relforcerowsecurity: boolean }>(`SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('report_versions', 'deal_memberships') ORDER BY relname`);
    expect(forced.rows.every((row) => row.relforcerowsecurity)).toBe(true);
    await expect(db.exec(`UPDATE report_versions SET version = 9 WHERE scope = 'EXECUTIVE'`)).rejects.toThrow(/is final/);
    await db.close();
  }, 120_000);
});
