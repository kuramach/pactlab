import { boundedLimit, isAnonymous, type ConnectionScope, type DryRunResult, type ValidationCheck, type ValidationResult } from '../contract';
import type { SecretStore } from '../credentials';
import type { FetchLike } from '../http/cassette';
import { CLOUD_ONLY, isJiraCloudHost, jiraSiteProblem, type JiraSitePolicy } from './allowlist';
import {
  JIRA_PROVIDER,
  JiraAdapterError,
  type JiraAdapter,
  type JiraConnectionConfig,
  type JiraGap,
  type JiraIssue,
  type JiraIssuePage,
  type JiraPerson,
  type JiraSprint,
  type JiraStatusCategory,
} from './types';

export const JIRA_LIVE_VERSION = 'jira-live-1';
const TIMEOUT_MS = 15_000;
const MAX_PAGE = 100;
/** Latest sprints read per board, and boards per project. */
const MAX_SPRINTS = 12;
const MAX_BOARDS = 5;
/** Pages of issues read to total one sprint's points. */
const MAX_SPRINT_PAGES = 10;

export interface JiraLiveOptions {
  readonly fetch?: FetchLike;
  readonly secrets?: SecretStore | null;
  readonly policy?: JiraSitePolicy;
}

interface RawUser {
  accountId?: string;
  key?: string;
  name?: string;
  displayName?: string | null;
}

interface RawIssue {
  key?: string;
  fields?: Record<string, unknown> & {
    issuetype?: { name?: string } | null;
    status?: { statusCategory?: { key?: string } | null } | null;
    priority?: { name?: string } | null;
    created?: string;
    resolutiondate?: string | null;
    assignee?: RawUser | null;
    reporter?: RawUser | null;
    comment?: { total?: number; comments?: unknown[] } | null;
  };
  changelog?: { histories?: { items?: { field?: string; from?: string | null; to?: string | null }[] }[] };
}

interface SiteMeta {
  readonly storyPointsField: string | null;
  readonly sprintField: string | null;
  /** Status ids in the done category, for reopen counting. */
  readonly doneStatuses: ReadonlySet<string>;
  readonly readable: readonly string[];
  readonly unreadable: readonly string[];
}

const CATEGORY: Readonly<Record<string, JiraStatusCategory>> = { new: 'TO_DO', indeterminate: 'IN_PROGRESS', done: 'DONE' };
const PRIORITY: Readonly<Record<string, JiraIssue['priority']>> = {
  highest: 'Highest',
  blocker: 'Highest',
  critical: 'Highest',
  high: 'High',
  major: 'High',
  medium: 'Medium',
  low: 'Low',
  minor: 'Low',
  lowest: 'Low',
  trivial: 'Low',
};

/** Normalized issue type, per the contract's documented mapping. */
export function normalizeIssueType(name: string): JiraIssue['type'] {
  if (/bug|defect/i.test(name)) return 'Bug';
  if (/story|feature|improvement|epic/i.test(name)) return 'Story';
  return 'Task';
}

/** Jira dates (`2026-10-24T01:07:35.000+0000`) as ISO 8601 UTC, or null. */
export function jiraDate(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const parsed = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** The last sprint id on an issue: Cloud gives objects, Data Center may give `…Sprint@x[id=12,…]` strings. */
export function sprintIdOf(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const last: unknown = value.at(-1);
  if (last && typeof last === 'object' && 'id' in last) {
    const id = (last as { id?: unknown }).id;
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
  }
  return typeof last === 'string' ? (/\[(?:[^\]]*,)?id=(\d+)[,\]]/.exec(last)?.[1] ?? null) : null;
}

const person = (user: RawUser | null | undefined): JiraPerson | null => {
  const id = user?.accountId ?? user?.key ?? user?.name;
  return id ? { accountId: id, displayName: user?.displayName ?? null } : null;
};

/**
 * Read-only Jira over the REST API (T-082): Atlassian Cloud (`/rest/api/3`,
 * enhanced JQL search with `nextPageToken`) and allowlisted self-hosted Data
 * Center servers (`/rest/api/2`, `startAt` paging). Delivery facts only —
 * issue summaries, descriptions and comment text are never requested.
 * HTTPS only, no redirects followed, payloads never logged.
 */
export class JiraLiveAdapter implements JiraAdapter {
  readonly provider = JIRA_PROVIDER;
  readonly mode = 'LIVE' as const;
  readonly version = JIRA_LIVE_VERSION;
  private meta: Promise<SiteMeta> | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly secrets: SecretStore | null;
  private readonly policy: JiraSitePolicy;

  constructor(
    readonly config: JiraConnectionConfig,
    options: JiraLiveOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.secrets = options.secrets ?? null;
    this.policy = options.policy ?? CLOUD_ONLY;
  }

  private get cloud(): boolean {
    return isJiraCloudHost(this.config.site);
  }

  private get api(): string {
    return this.cloud ? '/rest/api/3' : '/rest/api/2';
  }

  private async authorization(scope: ConnectionScope): Promise<Record<string, string>> {
    if (isAnonymous(scope.credentialRef) || !scope.credentialRef) return {};
    if (!this.secrets) throw new JiraAdapterError('NO_CREDENTIAL', 'No credential store is configured');
    let secret: string;
    try {
      secret = await this.secrets.get(scope.credentialRef);
    } catch {
      throw new JiraAdapterError('NO_CREDENTIAL', 'The stored Jira credential could not be read');
    }
    if (this.cloud) {
      // Atlassian Cloud: the account email and an API token, as Basic auth.
      if (!/^[^:\s]+@[^:\s]+:\S+$/.test(secret)) throw new JiraAdapterError('NO_CREDENTIAL', 'Jira Cloud needs the account email and an API token');
      return { authorization: `Basic ${Buffer.from(secret).toString('base64')}` };
    }
    // Data Center: a personal access token.
    return { authorization: `Bearer ${secret}` };
  }

  private async get<T>(scope: ConnectionScope, path: string, query: Record<string, string> = {}): Promise<T> {
    const problem = jiraSiteProblem(this.config.site, this.policy);
    if (problem) throw new JiraAdapterError('SITE_NOT_ALLOWED', problem);
    const search = new URLSearchParams(query).toString();
    const headers = { accept: 'application/json', 'user-agent': 'pactlab', ...(await this.authorization(scope)) };
    let response: Response;
    try {
      response = await this.fetchImpl(`https://${this.config.site}${this.config.basePath ?? ''}${path}${search ? `?${search}` : ''}`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Never follow a redirect: it could lead off the approved host.
        redirect: 'manual',
      });
    } catch {
      throw new JiraAdapterError('UNAVAILABLE', 'Jira could not be reached');
    }
    if (response.ok) return (await response.json()) as T;
    if (response.status === 401) throw new JiraAdapterError('NO_CREDENTIAL', 'Jira rejected the credential, or this site needs one');
    if (response.status === 403) throw new JiraAdapterError('PERMISSION_DENIED', 'The credential cannot read this');
    if (response.status === 404) throw new JiraAdapterError('PERMISSION_DENIED', 'Not found, or not visible to this credential');
    if (response.status === 429) throw new JiraAdapterError('RATE_LIMITED', 'Jira rate limit reached; retry later');
    if (response.status >= 300 && response.status < 400) throw new JiraAdapterError('UNAVAILABLE', 'Jira answered with a redirect; check the site and context path');
    throw new JiraAdapterError('UNAVAILABLE', `Jira answered ${response.status}`);
  }

  /** Field ids, done statuses and readable projects, read once per adapter. */
  private siteMeta(scope: ConnectionScope): Promise<SiteMeta> {
    if (this.meta) return this.meta;
    const meta = (async (): Promise<SiteMeta> => {
      const fields = await this.get<{ id?: string; name?: string; schema?: { custom?: string } }[]>(scope, `${this.api}/field`);
      const find = (test: (field: { name?: string; schema?: { custom?: string } }) => boolean) => fields.find(test)?.id ?? null;
      const storyPointsField = find(
        (field) => field.schema?.custom === 'com.pyxis.greenhopper.jira:jsw-story-points' || ['story points', 'story point estimate'].includes((field.name ?? '').toLowerCase()),
      );
      const sprintField = find((field) => field.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint');
      const statuses = await this.get<{ id?: string; statusCategory?: { key?: string } }[]>(scope, `${this.api}/status`);
      const doneStatuses = new Set(statuses.filter((status) => status.statusCategory?.key === 'done' && status.id).map((status) => status.id as string));
      const readable: string[] = [];
      const unreadable: string[] = [];
      for (const key of this.config.projectKeys) {
        try {
          await this.get(scope, `${this.api}/project/${key}`);
          readable.push(key);
        } catch (error) {
          if (!(error instanceof JiraAdapterError) || error.code !== 'PERMISSION_DENIED') throw error;
          unreadable.push(key);
        }
      }
      return { storyPointsField, sprintField, doneStatuses, readable, unreadable };
    })();
    this.meta = meta;
    // A failed read is retried on the next call rather than cached.
    meta.catch(() => {
      if (this.meta === meta) this.meta = null;
    });
    return meta;
  }

  async validateConnection(scope: ConnectionScope): Promise<ValidationResult> {
    const problem = jiraSiteProblem(this.config.site, this.policy);
    if (problem) {
      return {
        ok: false,
        checks: [
          { name: 'reachability', status: 'FAIL', detail: problem },
          { name: 'credentials', status: 'SKIPPED', detail: 'The site is not approved' },
          { name: 'scopes', status: 'SKIPPED', detail: 'The site is not approved' },
          { name: 'mappings', status: 'SKIPPED', detail: 'The site is not approved' },
        ],
      };
    }
    const checks: ValidationCheck[] = [];
    // A stored credential that cannot be read (or is the wrong shape) is said as such, before any request.
    try {
      await this.authorization(scope);
    } catch (error) {
      checks.push({ name: 'credentials', status: 'FAIL', detail: safeDetail(error) });
      checks.push({ name: 'reachability', status: 'SKIPPED', detail: 'Needs a working credential' });
      checks.push({ name: 'scopes', status: 'SKIPPED', detail: 'Needs a working credential' });
      checks.push({ name: 'mappings', status: 'SKIPPED', detail: 'Needs a working credential' });
      return { ok: false, checks };
    }
    try {
      await this.get(scope, `${this.api}/serverInfo`);
      checks.push({ name: 'reachability', status: 'PASS', detail: `${this.config.site} answers (Jira ${this.cloud ? 'Cloud' : 'Data Center'})` });
    } catch (error) {
      checks.push({ name: 'reachability', status: 'FAIL', detail: safeDetail(error) });
      checks.push({ name: 'credentials', status: 'SKIPPED', detail: 'Needs a reachable site' });
      checks.push({ name: 'scopes', status: 'SKIPPED', detail: 'Needs a reachable site' });
      checks.push({ name: 'mappings', status: 'SKIPPED', detail: 'Needs a reachable site' });
      return { ok: false, checks };
    }
    if (isAnonymous(scope.credentialRef)) {
      checks.push({ name: 'credentials', status: 'SKIPPED', detail: 'No credential: anonymous read, public projects only' });
    } else {
      try {
        await this.get(scope, `${this.api}/myself`);
        checks.push({ name: 'credentials', status: 'PASS', detail: 'Credential accepted' });
      } catch (error) {
        checks.push({ name: 'credentials', status: 'FAIL', detail: safeDetail(error) });
      }
    }
    try {
      const meta = await this.siteMeta(scope);
      checks.push({
        name: 'scopes',
        status: meta.readable.length > 0 ? 'PASS' : 'FAIL',
        detail: meta.unreadable.length === 0 ? 'All configured projects are readable' : `Not readable: ${meta.unreadable.join(', ')}`,
      });
      checks.push({
        name: 'mappings',
        status: 'PASS',
        detail: `Story points: ${meta.storyPointsField ? 'mapped' : 'no field on this site (estimates read as missing)'}; sprints: ${meta.sprintField ? 'mapped' : 'no sprint field on this site'}`,
      });
    } catch (error) {
      checks.push({ name: 'scopes', status: 'FAIL', detail: safeDetail(error) });
      checks.push({ name: 'mappings', status: 'SKIPPED', detail: 'Needs readable site metadata' });
    }
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  async dryRun(scope: ConnectionScope, options: { limit: number }): Promise<DryRunResult<JiraIssue>> {
    const page = await this.listIssues(scope, { cursor: null, limit: boundedLimit(options.limit) });
    return { sample: page.issues, truncated: page.nextCursor !== null };
  }

  /** One JQL search page in either flavour. */
  private async search(scope: ConnectionScope, jql: string, fields: readonly string[], cursor: string | null, limit: number, changelog: boolean) {
    const maxResults = String(Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE));
    const common = { jql, maxResults, fields: fields.join(','), ...(changelog ? { expand: 'changelog' } : {}) };
    if (this.cloud) {
      if (cursor !== null && !/^[A-Za-z0-9_\-=.+/]{1,2048}$/.test(cursor)) throw new JiraAdapterError('INVALID_CURSOR', 'Invalid cursor');
      const body = await this.get<{ issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean }>(scope, `${this.api}/search/jql`, {
        ...common,
        ...(cursor ? { nextPageToken: cursor } : {}),
      });
      return { issues: body.issues ?? [], next: body.isLast === false && body.nextPageToken ? body.nextPageToken : null };
    }
    if (cursor !== null && !/^\d{1,7}$/.test(cursor)) throw new JiraAdapterError('INVALID_CURSOR', 'Invalid cursor');
    const startAt = Number(cursor ?? '0');
    const body = await this.get<{ issues?: RawIssue[]; total?: number }>(scope, `${this.api}/search`, { ...common, startAt: String(startAt) });
    const issues = body.issues ?? [];
    const read = startAt + issues.length;
    return { issues, next: issues.length > 0 && typeof body.total === 'number' && read < body.total ? String(read) : null };
  }

  async listIssues(scope: ConnectionScope, options: { cursor: string | null; limit: number }): Promise<JiraIssuePage> {
    const meta = await this.siteMeta(scope);
    if (meta.readable.length === 0) throw new JiraAdapterError('PERMISSION_DENIED', 'None of the configured projects is readable');
    const fields = ['issuetype', 'status', 'priority', 'created', 'resolutiondate', 'assignee', 'reporter', 'comment', meta.storyPointsField, meta.sprintField].filter(
      (field): field is string => Boolean(field),
    );
    const jql = `project in (${meta.readable.join(', ')}) ORDER BY created ASC, key ASC`;
    const page = await this.search(scope, jql, fields, options.cursor, options.limit, true);
    const issues = page.issues.map((raw) => this.issueOf(raw, meta)).filter((issue): issue is JiraIssue => issue !== null);
    const gaps: JiraGap[] = [];
    // Unreadable projects and a missing story-point field are said once, on the first page.
    if (options.cursor === null) {
      for (const project of meta.unreadable) gaps.push({ code: 'PERMISSION_DENIED', detail: `Project ${project} is not readable by this credential` });
      if (!meta.storyPointsField) gaps.push({ code: 'MISSING_FIELD', detail: `${this.config.site} has no story-point field; estimates read as missing` });
    }
    if (page.issues.some((raw) => !raw.changelog)) gaps.push({ code: 'MISSING_FIELD', detail: 'Issue history was not returned, so reopen counts read as zero for some issues' });
    return { issues, nextCursor: page.next, gaps };
  }

  private issueOf(raw: RawIssue, meta: SiteMeta): JiraIssue | null {
    const fields = raw.fields;
    const createdAt = jiraDate(fields?.created);
    if (!raw.key || !fields || !createdAt) return null;
    const typeName = fields.issuetype?.name ?? 'Task';
    const type = normalizeIssueType(typeName);
    const points = meta.storyPointsField ? fields[meta.storyPointsField] : null;
    const reopenCount = (raw.changelog?.histories ?? [])
      .flatMap((history) => history.items ?? [])
      .filter((item) => item.field === 'status' && item.from && meta.doneStatuses.has(item.from) && item.to && !meta.doneStatuses.has(item.to)).length;
    return {
      key: raw.key,
      project: raw.key.split('-')[0] ?? '',
      type,
      ...(typeName !== type ? { providerType: typeName } : {}),
      statusCategory: CATEGORY[fields.status?.statusCategory?.key ?? ''] ?? 'TO_DO',
      priority: PRIORITY[(fields.priority?.name ?? '').toLowerCase()] ?? null,
      storyPoints: typeof points === 'number' && Number.isFinite(points) ? points : null,
      sprintId: meta.sprintField ? sprintIdOf(fields[meta.sprintField]) : null,
      createdAt,
      resolvedAt: jiraDate(fields.resolutiondate),
      reopenCount,
      assignee: person(fields.assignee),
      reporter: person(fields.reporter),
      commentCount: fields.comment?.total ?? fields.comment?.comments?.length ?? 0,
    };
  }

  /**
   * Closed and active sprints from the Agile API (latest per board), with
   * committed and completed points totalled from each sprint's issues.
   * Throws PERMISSION_DENIED when boards are not readable on this site.
   */
  async listSprints(scope: ConnectionScope): Promise<readonly JiraSprint[]> {
    const meta = await this.siteMeta(scope);
    const sprints: JiraSprint[] = [];
    for (const project of meta.readable) {
      let boards: { values?: { id?: number; type?: string }[] };
      try {
        boards = await this.get(scope, '/rest/agile/1.0/board', { projectKeyOrId: project, maxResults: '50' });
      } catch (error) {
        // Agile boards are often closed to anonymous or narrow credentials while issues are open.
        if (error instanceof JiraAdapterError && (error.code === 'NO_CREDENTIAL' || error.code === 'PERMISSION_DENIED'))
          throw new JiraAdapterError('PERMISSION_DENIED', 'Sprints are not readable on this site');
        throw error;
      }
      for (const board of (boards.values ?? []).filter((entry) => entry.type === 'scrum' && typeof entry.id === 'number').slice(0, MAX_BOARDS)) {
        const found: { id?: number; state?: string; name?: string; startDate?: string; endDate?: string }[] = [];
        let startAt = 0;
        for (let pages = 0; pages < 20; pages += 1) {
          const page = await this.get<{ values?: typeof found; isLast?: boolean }>(scope, `/rest/agile/1.0/board/${board.id}/sprint`, {
            state: 'active,closed',
            startAt: String(startAt),
            maxResults: '50',
          });
          found.push(...(page.values ?? []));
          startAt += page.values?.length ?? 0;
          if (page.isLast !== false || (page.values?.length ?? 0) === 0) break;
        }
        const latest = found
          .filter((sprint) => typeof sprint.id === 'number' && jiraDate(sprint.startDate))
          .sort((a, b) => (jiraDate(b.startDate) ?? '').localeCompare(jiraDate(a.startDate) ?? ''))
          .slice(0, MAX_SPRINTS);
        for (const sprint of latest) {
          if (sprints.some((entry) => entry.id === String(sprint.id))) continue;
          const points = await this.sprintPoints(scope, meta, sprint.id as number);
          sprints.push({
            id: String(sprint.id),
            project,
            name: sprint.name ?? `Sprint ${sprint.id}`,
            state: sprint.state === 'active' ? 'active' : 'closed',
            startAt: jiraDate(sprint.startDate) as string,
            endAt: jiraDate(sprint.endDate),
            ...points,
          });
        }
      }
    }
    return sprints;
  }

  /** Committed points: every issue in the sprint; completed: those in the done category. */
  private async sprintPoints(scope: ConnectionScope, meta: SiteMeta, sprintId: number) {
    const field = meta.storyPointsField;
    if (!field) return { committedPoints: 0, completedPoints: 0 };
    let committed = 0;
    let completed = 0;
    let cursor: string | null = null;
    for (let pages = 0; pages < MAX_SPRINT_PAGES; pages += 1) {
      const page = await this.search(scope, `sprint = ${sprintId}`, ['status', field], cursor, MAX_PAGE, false);
      for (const raw of page.issues) {
        const value = raw.fields?.[field];
        const points = typeof value === 'number' && Number.isFinite(value) ? value : 0;
        committed += points;
        if (raw.fields?.status?.statusCategory?.key === 'done') completed += points;
      }
      cursor = page.next;
      if (cursor === null) break;
    }
    return { committedPoints: committed, completedPoints: completed };
  }
}

/** Error text safe for the onboarding UI: adapter messages only, never provider payloads. */
function safeDetail(error: unknown): string {
  return error instanceof JiraAdapterError ? error.message : 'Jira could not be checked';
}
