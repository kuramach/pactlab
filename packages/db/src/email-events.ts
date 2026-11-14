import { OperatorRequiredError, type SqlExecutor } from './ops';

/**
 * Email delivery events and the do-not-send list (T-109, ADR 0032): thin wrappers over the
 * `app_email_*` functions. Addresses never reach the database, only a keyed hash and the domain.
 */
export type EmailEventType = 'BOUNCE' | 'COMPLAINT' | 'DELIVERY' | 'REJECT' | 'RENDERING_FAILURE';
export type SuppressionReason = 'HARD_BOUNCE' | 'COMPLAINT';

export interface EmailEventRecord {
  type: EmailEventType;
  recipientHash: string;
  recipientDomain: string;
  sesMessageId: string;
  snsMessageId: string;
  bounceType: string | null;
  bounceSubtype: string | null;
  diagnostic: string | null;
  occurredAt: Date;
}

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

export const emailEvents = {
  /** Record one event; false when SNS redelivered one already recorded. */
  async record(sql: SqlExecutor, event: EmailEventRecord): Promise<boolean> {
    const [row] = rows<{ app_email_event_record: boolean }>(
      await sql.query('SELECT app_email_event_record($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)', [
        event.type,
        event.recipientHash,
        event.recipientDomain,
        event.sesMessageId,
        event.snsMessageId,
        event.bounceType,
        event.bounceSubtype,
        event.diagnostic,
        event.occurredAt.toISOString(),
      ]),
    );
    return row?.app_email_event_record === true;
  },

  async suppressed(sql: SqlExecutor, recipientHash: string): Promise<SuppressionReason | null> {
    const [row] = rows<{ app_email_suppressed: SuppressionReason | null }>(await sql.query('SELECT app_email_suppressed($1)', [recipientHash]));
    return row?.app_email_suppressed ?? null;
  },

  /** Operators: counts by event type over the last `days`, and the size of the list. */
  async health(sql: SqlExecutor, actor: string | null, days: number): Promise<{ counts: Record<EmailEventType, number>; suppressed: number }> {
    let result: { event_type: EmailEventType; events: bigint | number; suppressed: bigint | number }[];
    try {
      result = rows(await sql.query('SELECT * FROM app_ops_email_health($1::uuid, $2::int)', [actor, days]));
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string }; message?: string };
      if (failure.code === '42501' || failure.meta?.code === '42501' || /\b42501\b|operator required/i.test(String(failure.message))) throw new OperatorRequiredError();
      throw error;
    }
    const counts = { DELIVERY: 0, BOUNCE: 0, COMPLAINT: 0, REJECT: 0, RENDERING_FAILURE: 0 } as Record<EmailEventType, number>;
    for (const row of result) counts[row.event_type] = Number(row.events);
    return { counts, suppressed: Number(result[0]?.suppressed ?? 0) };
  },
};
