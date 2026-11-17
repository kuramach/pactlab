import { KAFKA_SNAPSHOT_REPOSITORY, KAFKA_SNAPSHOT_SITE } from '@pactlab/connectors';
import { decodeCursor, encodeCursor, type TransactionClient } from '@pactlab/db';
import { z } from 'zod';

/**
 * What sits behind one point on the Engineering charts (T-129): the pull requests of a month,
 * the Jira issues resolved in a month, with their links both ways. Read from the synced evidence
 * (newest version of each record), a page at a time; nothing is fetched from GitHub or Jira.
 */
export const activityQuery = z.strictObject({
  kind: z.enum(['code', 'delivery']),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  type: z.enum(['Story', 'Bug', 'Task']).optional(),
  status: z.enum(['TO_DO', 'IN_PROGRESS', 'DONE']).optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ActivityQuery = z.infer<typeof activityQuery>;

type Canonical = Record<string, string | null | undefined>;
interface Source {
  readonly id: string;
  readonly provider: string;
  readonly mode: string;
  readonly config: unknown;
}

/**
 * A link out only where the system is real: a live connection, or the recorded apache/kafka and
 * Apache Jira data (T-127). Synthetic fixture hosts do not exist, so they get no link.
 */
export function sourceUrl(source: Source | undefined, record: { issueKey: string } | { pull: string } | { commit: string }): string | null {
  if (!source) return null;
  const config = (source.config ?? {}) as { repository?: string; site?: string; basePath?: string };
  const real = source.mode === 'LIVE' || config.repository === KAFKA_SNAPSHOT_REPOSITORY || config.site === KAFKA_SNAPSHOT_SITE;
  if (!real) return null;
  if ('issueKey' in record) return config.site ? `https://${config.site}${config.basePath ?? ''}/browse/${encodeURIComponent(record.issueKey)}` : null;
  if (!config.repository) return null;
  return 'pull' in record ? `https://github.com/${config.repository}/pull/${encodeURIComponent(record.pull)}` : `https://github.com/${config.repository}/commit/${encodeURIComponent(record.commit)}`;
}

const LATEST = (type: string) => `
  SELECT DISTINCT ON (connection_id, source_record_id) connection_id::text AS connection_id, source_record_id, canonical
    FROM evidence_items WHERE deal_id = $1::uuid AND evidence_type = '${type}'
   ORDER BY connection_id, source_record_id, created_at DESC, id DESC`;

type Row = { connection_id: string; source_record_id: string; canonical: Canonical };

/** Jira issues resolved in the month, newest first, each with the commits and pull requests that cite it. */
export async function deliveryActivity(tx: TransactionClient, dealId: string, query: ActivityQuery, sources: ReadonlyMap<string, Source>) {
  const after = decodeCursor(query.cursor, { textId: true });
  const filters = `canonical->>'resolvedAt' LIKE $2 || '%' AND ($3::text IS NULL OR canonical->>'type' = $3) AND ($4::text IS NULL OR canonical->>'statusCategory' = $4)`;
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `WITH latest AS (${LATEST('delivery.issue')})
     SELECT * FROM latest WHERE ${filters}
        AND ($5::text IS NULL OR (canonical->>'resolvedAt', source_record_id) < ($5::text, $6::text))
      ORDER BY canonical->>'resolvedAt' DESC, source_record_id DESC LIMIT $7`,
    dealId, query.month, query.type ?? null, query.status ?? null, after ? String(after.key) : null, after?.id ?? null, query.limit + 1,
  );
  const [counted] = await tx.$queryRawUnsafe<{ n: bigint }[]>(`WITH latest AS (${LATEST('delivery.issue')}) SELECT count(*) AS n FROM latest WHERE ${filters}`, dealId, query.month, query.type ?? null, query.status ?? null);
  const page = rows.slice(0, query.limit);
  const keys = page.map((row) => row.canonical['key'] ?? row.source_record_id);
  // bounded: the links of at most one page of issues
  const links = keys.length === 0 ? [] : await tx.$queryRawUnsafe<Row[]>(`WITH latest AS (${LATEST('code.issue_link')}) SELECT * FROM latest WHERE canonical->>'issueKey' = ANY($2::text[])`, dealId, keys);
  const last = page.at(-1);
  return {
    items: page.map((row) => {
      const c = row.canonical;
      const key = c['key'] ?? row.source_record_id;
      return {
        key,
        type: c['type'] ?? null,
        providerType: c['providerType'] ?? null,
        priority: c['priority'] ?? null,
        statusCategory: c['statusCategory'] ?? null,
        createdAt: c['createdAt'] ?? null,
        resolvedAt: c['resolvedAt'] ?? null,
        reopenCount: Number(c['reopenCount'] ?? 0),
        url: sourceUrl(sources.get(row.connection_id), { issueKey: key }),
        code: links
          .filter((link) => link.canonical['issueKey'] === key)
          .map((link) => {
            const kind = link.canonical['kind'] === 'COMMIT' ? ('COMMIT' as const) : ('PULL_REQUEST' as const);
            const id = link.canonical['id'] ?? '';
            return { kind, id, url: sourceUrl(sources.get(link.connection_id), kind === 'COMMIT' ? { commit: id } : { pull: id }) };
          }),
      };
    }),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.canonical['resolvedAt'] ?? '', last.source_record_id) : null,
    total: Number(counted?.n ?? 0),
    limit: query.limit,
  };
}

/** Pull requests opened or merged in the month, newest first, with reviews, CI and the issues they name. */
export async function codeActivity(tx: TransactionClient, dealId: string, query: ActivityQuery, sources: ReadonlyMap<string, Source>, labelOf: (contributorKey: string) => string | null) {
  const after = decodeCursor(query.cursor, { textId: true });
  const at = `coalesce(canonical->>'mergedAt', canonical->>'createdAt')`;
  const filters = `(canonical->>'createdAt' LIKE $2 || '%' OR canonical->>'mergedAt' LIKE $2 || '%')`;
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `WITH latest AS (${LATEST('code.pull_request')})
     SELECT * FROM latest WHERE ${filters} AND ($3::text IS NULL OR (${at}, source_record_id) < ($3::text, $4::text))
      ORDER BY ${at} DESC, source_record_id DESC LIMIT $5`,
    dealId, query.month, after ? String(after.key) : null, after?.id ?? null, query.limit + 1,
  );
  const [counted] = await tx.$queryRawUnsafe<{ n: bigint }[]>(`WITH latest AS (${LATEST('code.pull_request')}) SELECT count(*) AS n FROM latest WHERE ${filters}`, dealId, query.month);
  const page = rows.slice(0, query.limit);
  const numbers = page.map((row) => row.canonical['number'] ?? '');
  // bounded: the links of at most one page of pull requests
  const links = numbers.length === 0 ? [] : await tx.$queryRawUnsafe<Row[]>(`WITH latest AS (${LATEST('code.issue_link')}) SELECT * FROM latest WHERE canonical->>'kind' = 'PULL_REQUEST' AND canonical->>'id' = ANY($2::text[])`, dealId, numbers);
  const last = page.at(-1);
  const count = (value: string | null | undefined) => (value === null || value === undefined ? null : Number(value));
  return {
    items: page.map((row) => {
      const c = row.canonical;
      const number = c['number'] ?? '';
      return {
        number: Number(number),
        title: c['title'] ?? null,
        state: c['state'] ?? null,
        createdAt: c['createdAt'] ?? null,
        mergedAt: c['mergedAt'] ?? null,
        author: c['authorKey'] ? labelOf(c['authorKey']) : null,
        approvals: count(c['approvals']),
        changesRequested: count(c['changesRequested']),
        checksTotal: count(c['checksTotal']),
        checksFailed: count(c['checksFailed']),
        url: sourceUrl(sources.get(row.connection_id), { pull: number }),
        issues: [...new Set(links.filter((link) => link.canonical['id'] === number).map((link) => link.canonical['issueKey'] ?? ''))].filter(Boolean),
      };
    }),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.canonical['mergedAt'] ?? last.canonical['createdAt'] ?? '', last.source_record_id) : null,
    total: Number(counted?.n ?? 0),
    limit: query.limit,
  };
}
