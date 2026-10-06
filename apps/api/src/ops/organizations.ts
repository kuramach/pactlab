import { newId } from '@pactlab/domain';
import type { EmailSender } from '../email-login/email-sender';
import { emails } from '../email-login/emails';

/** Schema-owner SQL access (operator procedures run outside tenant context). */
export interface OwnerSql {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface PendingOrganization {
  slug: string;
  name: string;
  ssoRequested: boolean;
  createdAt: Date;
  owners: string;
}

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

export async function listPending(sql: OwnerSql): Promise<PendingOrganization[]> {
  return rows<PendingOrganization>(
    await sql.query(
      `SELECT o.slug, o.name, o.sso_requested AS "ssoRequested", o.created_at AS "createdAt",
              coalesce(string_agg(u.email, ', ' ORDER BY u.email), '') AS owners
         FROM organizations o
         LEFT JOIN organization_memberships m ON m.organization_id = o.id AND m.role = 'ORG_OWNER'
         LEFT JOIN users u ON u.id = m.user_id
        WHERE o.status = 'PENDING_APPROVAL'
        GROUP BY o.id ORDER BY o.created_at`,
    ),
  );
}

export type DecisionOutcome =
  | { kind: 'changed'; name: string; notified: string[]; notDelivered: string[] }
  | { kind: 'unchanged'; status: string }
  | { kind: 'not-found' };

/**
 * Approve (ACTIVE) or reject (SUSPENDED) a signed-up organization. Idempotent;
 * audited; approval emails each owner when a sender is available.
 */
export async function decide(
  sql: OwnerSql,
  slug: string,
  decision: 'approve' | 'reject',
  options: { sender: EmailSender | null; loginUrl: string },
): Promise<DecisionOutcome> {
  const target = decision === 'approve' ? 'ACTIVE' : 'SUSPENDED';
  const [org] = rows<{ id: string; name: string; status: string }>(
    await sql.query(`SELECT id, name, status FROM organizations WHERE slug = $1`, [slug]),
  );
  if (!org) return { kind: 'not-found' };
  if (org.status === target) return { kind: 'unchanged', status: org.status };

  await sql.query(`UPDATE organizations SET status = $2, updated_at = now() WHERE id = $1`, [org.id, target]);
  await sql.query(
    `INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
     VALUES ($1, $2, NULL, NULL, $3, 'organization', $4, 'SUCCEEDED')`,
    [newId(), org.id, decision === 'approve' ? 'org.approved' : 'org.rejected', org.id],
  );
  if (decision === 'reject') return { kind: 'changed', name: org.name, notified: [], notDelivered: [] };

  const owners = rows<{ email: string | null }>(
    await sql.query(
      `SELECT u.email FROM organization_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.role = 'ORG_OWNER' AND m.status = 'ACTIVE'`,
      [org.id],
    ),
  )
    .map((row) => row.email)
    .filter((email): email is string => email !== null);
  const notified: string[] = [];
  const notDelivered: string[] = [];
  for (const email of owners) {
    try {
      if (!options.sender) throw new Error('no sender');
      await options.sender.send(emails.organizationApproved(email, org.name, options.loginUrl));
      notified.push(email);
    } catch {
      notDelivered.push(email);
    }
  }
  return { kind: 'changed', name: org.name, notified, notDelivered };
}
