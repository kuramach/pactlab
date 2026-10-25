import { operatorOps, type PendingOrganization, type SqlExecutor } from '@pactlab/db';
import type { EmailSender } from '../email-login/email-sender';
import { emails } from '../email-login/emails';

/** SQL access for operator procedures: the schema owner (CLI) or the runtime role (console). */
export type OwnerSql = SqlExecutor;
export type { PendingOrganization };


/**
 * Approvals run through `app_ops_*` SQL functions (T-072), so the CLI (schema
 * owner, no actor) and the admin console (an operator) share one
 * implementation. Emails stay here.
 */
export async function listPending(sql: OwnerSql, actor: string | null = null): Promise<PendingOrganization[]> {
  return operatorOps.pendingOrganizations(sql, actor);
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
  actor: string | null = null,
): Promise<DecisionOutcome> {
  const result = await operatorOps.decideOrganization(sql, actor, slug, decision);
  if (result.outcome === 'not-found') return { kind: 'not-found' };
  if (result.outcome === 'unchanged') return { kind: 'unchanged', status: result.status ?? '' };
  const name = result.name ?? slug;
  const notified: string[] = [];
  const notDelivered: string[] = [];
  for (const email of decision === 'approve' ? result.ownerEmails : []) {
    try {
      if (!options.sender) throw new Error('no sender');
      await options.sender.send(emails.organizationApproved(email, name, options.loginUrl));
      notified.push(email);
    } catch {
      notDelivered.push(email);
    }
  }
  return { kind: 'changed', name, notified, notDelivered };
}
