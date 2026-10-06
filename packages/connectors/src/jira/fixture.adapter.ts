import { boundedLimit, type ConnectionScope, type DryRunResult, type ValidationCheck, type ValidationResult } from '../contract';
import { JIRA_FIXTURES, type JiraFixtureSite } from './fixture-data';
import {
  JIRA_PROVIDER,
  JiraAdapterError,
  type JiraAdapter,
  type JiraConnectionConfig,
  type JiraIssue,
  type JiraIssuePage,
  type JiraSprint,
} from './types';

export const JIRA_FIXTURE_VERSION = 'jira-fixture-1';
const MAX_PAGE = 100;

/** Synthetic Jira sites behind the same normalized interface as live Jira. */
export class JiraFixtureAdapter implements JiraAdapter {
  readonly provider = JIRA_PROVIDER;
  readonly mode = 'FIXTURE' as const;
  readonly version = JIRA_FIXTURE_VERSION;

  constructor(readonly config: JiraConnectionConfig) {}

  private fixture(): JiraFixtureSite | undefined {
    return Object.hasOwn(JIRA_FIXTURES, this.config.site) ? JIRA_FIXTURES[this.config.site] : undefined;
  }

  private readable(): { site: JiraFixtureSite; projects: readonly string[] } {
    const site = this.fixture();
    if (!site) throw new JiraAdapterError('UNKNOWN_SITE', 'Site is not an available fixture');
    const projects = this.config.projectKeys.filter((key) => site.readableProjects.includes(key));
    return { site, projects };
  }

  /** Projects in the config that the installation cannot read. */
  unreadableProjects(): readonly string[] {
    const site = this.fixture();
    return this.config.projectKeys.filter((key) => !site?.readableProjects.includes(key));
  }

  async validateConnection(_scope: ConnectionScope): Promise<ValidationResult> {
    const site = this.fixture();
    const unreadable = this.unreadableProjects();
    const checks: ValidationCheck[] = [
      {
        name: 'reachability',
        status: site ? 'PASS' : 'FAIL',
        detail: site ? 'Fixture site available' : 'Site is not an available fixture',
      },
      { name: 'credentials', status: 'SKIPPED', detail: 'Fixture mode uses no credentials' },
      {
        name: 'scopes',
        status: site && unreadable.length < this.config.projectKeys.length ? 'PASS' : 'FAIL',
        detail:
          unreadable.length === 0
            ? 'All configured projects are readable'
            : `Not readable: ${unreadable.join(', ')}`,
      },
      {
        name: 'mappings',
        status: site ? 'PASS' : 'FAIL',
        detail: 'Issue type, status category, priority, story points and sprint mapped',
      },
    ];
    return { ok: checks.every((check) => check.status !== 'FAIL'), checks };
  }

  async dryRun(scope: ConnectionScope, options: { limit: number }): Promise<DryRunResult<JiraIssue>> {
    const page = await this.listIssues(scope, { cursor: null, limit: boundedLimit(options.limit) });
    return { sample: page.issues, truncated: page.nextCursor !== null };
  }

  async listIssues(
    _scope: ConnectionScope,
    options: { cursor: string | null; limit: number },
  ): Promise<JiraIssuePage> {
    const { site, projects } = this.readable();
    const all = site.issues.filter((issue) => projects.includes(issue.project));
    const offset = options.cursor === null ? 0 : Number(options.cursor);
    if (!Number.isInteger(offset) || offset < 0 || offset > all.length)
      throw new JiraAdapterError('INVALID_CURSOR', 'Invalid cursor');
    const limit = Math.min(Math.max(1, options.limit), MAX_PAGE);
    const issues = all.slice(offset, offset + limit);
    const next = offset + issues.length;
    return { issues, nextCursor: next < all.length ? String(next) : null };
  }

  async listSprints(_scope: ConnectionScope): Promise<readonly JiraSprint[]> {
    const { site, projects } = this.readable();
    return site.sprints.filter((sprint) => projects.includes(sprint.project));
  }
}
