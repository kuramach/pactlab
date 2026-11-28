import { callOps, type SqlExecutor } from './ops';
import { decodeCursor, encodeCursor, type PageRequest, type PageResult } from './pagination';

/**
 * Feature proposals (T-176): typed wrappers over the `app_feature_*` SECURITY DEFINER functions. The tables
 * have no policy for the runtime role, so these functions are the only way in: intake and "mine" act for the
 * verified requester, the rest check the actor is a platform operator first.
 */
export interface FeatureCandidateRow {
  id: string;
  title: string;
  description: string;
  status: string;
}

export interface FeatureListRow {
  id: string;
  number: number;
  title: string;
  surface: 'SITE' | 'APP';
  locale: string;
  page: string;
  status: string;
  declineReason: string | null;
  relatedId: string | null;
  taskId: string | null;
  supporters: number;
  suggested: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureDetailRow extends Omit<FeatureListRow, 'supporters' | 'suggested'> {
  description: string;
  infoQuestion: string | null;
  infoReply: string | null;
  relatedTitle: string | null;
  relatedStatus: string | null;
  relatedReason: string | null;
  taskSpec: unknown;
  pullRequestUrl: string | null;
  whatsNewUrl: string | null;
}

export interface FeatureSupporterRow {
  id: string;
  grouping: 'ORIGINAL' | 'SUGGESTED' | 'CONFIRMED';
  surface: 'SITE' | 'APP';
  locale: string;
  page: string;
  title: string;
  description: string;
  email: string | null;
  userId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  transcript: unknown;
  createdAt: Date;
}

export interface MyFeatureRow {
  id: string;
  proposalId: string;
  number: number;
  title: string;
  description: string;
  status: string;
  declineReason: string | null;
  question: string | null;
  whatsNewUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureFileInput {
  organizationId: string | null;
  userId: string | null;
  email: string | null;
  surface: 'SITE' | 'APP';
  locale: string;
  page: string;
  title: string;
  description: string;
  transcript: unknown[];
  matchId: string | null;
}

export interface FeatureFiled {
  outcome: 'CREATED' | 'ATTACHED' | 'RATE_LIMITED';
  proposalId: string | null;
  number: number | null;
  earlierStatus: string | null;
  earlierReason: string | null;
}

type Row = Record<string, unknown>;
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const date = (value: unknown) => new Date(value as string);
const ask = (request: PageRequest) => request.limit + 1;

function after(request: PageRequest): [Date | null, string | null] {
  const position = decodeCursor(request.cursor);
  return position && typeof position.key === 'string' ? [new Date(position.key), position.id] : [null, null];
}

function page<T>(found: Row[], request: PageRequest, keyOf: (row: Row) => Date, map: (row: Row) => T): PageResult<T> {
  const shown = found.slice(0, request.limit);
  const last = shown.at(-1);
  return {
    items: shown.map(map),
    nextCursor: last && found.length > request.limit ? encodeCursor(keyOf(last), String(last['id'])) : null,
    total: Number(found[0]?.['total'] ?? 0),
    limit: request.limit,
  };
}

const listRow = (row: Row): FeatureListRow => ({
  id: String(row['id']),
  number: Number(row['number']),
  title: String(row['title']),
  surface: row['surface'] as 'SITE' | 'APP',
  locale: String(row['locale']),
  page: String(row['page']),
  status: String(row['status']),
  declineReason: text(row['decision_reason']),
  relatedId: text(row['related_id']),
  taskId: text(row['task_id']),
  supporters: Number(row['supporters']),
  suggested: Number(row['suggested']),
  createdAt: date(row['created_at']),
  updatedAt: date(row['updated_at']),
});

export const featureRequests = {
  /** Recent proposals the similarity screen compares a new request with (titles and wording only, never who asked). */
  async candidates(sql: SqlExecutor): Promise<FeatureCandidateRow[]> {
    return (await callOps<Row>(sql, 'SELECT * FROM app_feature_candidates()', [])).map((row) => ({ id: String(row['id']), title: String(row['title']), description: String(row['description']), status: String(row['status']) }));
  },

  /** File a confirmed request for a requester the API has verified. */
  async file(sql: SqlExecutor, input: FeatureFileInput): Promise<FeatureFiled> {
    const [row] = await callOps<Row>(sql, 'SELECT * FROM app_feature_file($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::uuid)', [
      input.organizationId,
      input.userId,
      input.email,
      input.surface,
      input.locale,
      input.page,
      input.title,
      input.description,
      JSON.stringify(input.transcript),
      input.matchId,
    ]);
    if (!row) throw new Error('Feature request was not filed');
    return { outcome: row['outcome'] as FeatureFiled['outcome'], proposalId: text(row['proposal_id']), number: row['number'] === null ? null : Number(row['number']), earlierStatus: text(row['earlier_status']), earlierReason: text(row['earlier_reason']) };
  },

  /** The caller's own requests, newest first. Scoped to them in SQL. */
  async minePage(sql: SqlExecutor, actor: string, request: PageRequest): Promise<PageResult<MyFeatureRow>> {
    const [afterAt, afterId] = after(request);
    const found = await callOps<Row>(sql, 'SELECT * FROM app_feature_mine_page($1::uuid, $2::timestamptz, $3::uuid, $4::int)', [actor, afterAt, afterId, ask(request)]);
    // The page key is the request's own filing time, which the function orders by.
    return page(found, request, (row) => date(row['created_at']), (row) => ({
      id: String(row['id']),
      proposalId: String(row['proposal_id']),
      number: Number(row['number']),
      title: String(row['title']),
      description: String(row['description']),
      status: String(row['status']),
      declineReason: text(row['decision_reason']),
      question: text(row['info_question']),
      whatsNewUrl: text(row['whats_new_url']),
      createdAt: date(row['created_at']),
      updatedAt: date(row['updated_at']),
    }));
  },

  /** A requester answers the question they were asked. False when it is not theirs or nothing was asked. */
  async reply(sql: SqlExecutor, actor: string, proposalId: string, reply: string): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_feature_reply($1::uuid, $2::uuid, $3) AS ok', [actor, proposalId, reply]);
    return Boolean(row?.ok);
  },

  async queuePage(sql: SqlExecutor, actor: string, filter: { status?: string | null; query?: string | null }, request: PageRequest): Promise<PageResult<FeatureListRow>> {
    const [afterAt, afterId] = after(request);
    const found = await callOps<Row>(sql, 'SELECT * FROM app_feature_page($1::uuid, $2, $3, $4::timestamptz, $5::uuid, $6::int)', [actor, filter.status ?? null, filter.query ?? null, afterAt, afterId, ask(request)]);
    return page(found, request, (row) => date(row['updated_at']), listRow);
  },

  async get(sql: SqlExecutor, actor: string, id: string): Promise<FeatureDetailRow | null> {
    const [row] = await callOps<Row>(sql, 'SELECT * FROM app_feature_get($1::uuid, $2::uuid)', [actor, id]);
    if (!row) return null;
    return {
      ...listRow({ ...row, supporters: 0, suggested: 0 }),
      description: String(row['description']),
      infoQuestion: text(row['info_question']),
      infoReply: text(row['info_reply']),
      relatedTitle: text(row['related_title']),
      relatedStatus: text(row['related_status']),
      relatedReason: text(row['related_reason']),
      taskSpec: row['task_spec'] ?? null,
      pullRequestUrl: text(row['pull_request_url']),
      whatsNewUrl: text(row['whats_new_url']),
    };
  },

  async supportersPage(sql: SqlExecutor, actor: string, proposalId: string, request: PageRequest): Promise<PageResult<FeatureSupporterRow>> {
    const [afterAt, afterId] = after(request);
    const found = await callOps<Row>(sql, 'SELECT * FROM app_feature_supporters_page($1::uuid, $2::uuid, $3::timestamptz, $4::uuid, $5::int)', [actor, proposalId, afterAt, afterId, ask(request)]);
    return page(found, request, (row) => date(row['created_at']), (row) => ({
      id: String(row['id']),
      grouping: row['grouped_as'] as FeatureSupporterRow['grouping'],
      surface: row['surface'] as 'SITE' | 'APP',
      locale: String(row['locale']),
      page: String(row['page']),
      title: String(row['title']),
      description: String(row['description']),
      email: text(row['email']),
      userId: text(row['user_id']),
      organizationId: text(row['organization_id']),
      organizationName: text(row['organization_name']),
      transcript: row['transcript'] ?? [],
      createdAt: date(row['created_at']),
    }));
  },

  /** Confirm a suggested requester as the same ask (true) or split them into a proposal of their own (false). Returns the proposal id. */
  async group(sql: SqlExecutor, actor: string, supporterId: string, confirm: boolean): Promise<string | null> {
    const [row] = await callOps<{ id: string | null }>(sql, 'SELECT app_feature_group($1::uuid, $2::uuid, $3) AS id', [actor, supporterId, confirm]);
    return row?.id ?? null;
  },

  async decide(sql: SqlExecutor, actor: string, id: string, action: 'TRIAGE' | 'DECLINE' | 'REQUEST_INFO' | 'REOPEN', note: string | null): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_feature_decide($1::uuid, $2::uuid, $3, $4) AS ok', [actor, id, action, note]);
    return Boolean(row?.ok);
  },

  async approve(sql: SqlExecutor, actor: string, id: string, spec: unknown): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_feature_approve($1::uuid, $2::uuid, $3::jsonb) AS ok', [actor, id, JSON.stringify(spec)]);
    return Boolean(row?.ok);
  },

  async link(sql: SqlExecutor, actor: string, id: string, links: { taskId: string | null; pullRequestUrl: string | null; whatsNewUrl: string | null }): Promise<boolean> {
    const [row] = await callOps<{ ok: boolean }>(sql, 'SELECT app_feature_link($1::uuid, $2::uuid, $3, $4, $5) AS ok', [actor, id, links.taskId, links.pullRequestUrl, links.whatsNewUrl]);
    return Boolean(row?.ok);
  },

  /** The public-site requesters to email about a status change. */
  async siteRequesters(sql: SqlExecutor, actor: string, id: string): Promise<{ email: string; locale: string; title: string }[]> {
    return (await callOps<Row>(sql, 'SELECT * FROM app_feature_site_requesters($1::uuid, $2::uuid)', [actor, id])).map((row) => ({ email: String(row['email']), locale: String(row['locale']), title: String(row['title']) }));
  },
};
