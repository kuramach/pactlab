import type { ConnectionMode } from '../contract';
import { JiraFixtureAdapter } from './fixture.adapter';
import { JiraLiveAdapter } from './live.adapter';
import { jiraConnectionConfigSchema, type JiraAdapter } from './types';

export * from './evidence';
export * from './fixture.adapter';
export * from './live.adapter';
export * from './types';
export { JIRA_FIXTURES } from './fixture-data';

/** The only place that looks at mode; callers see the normalized adapter. */
export function createJiraAdapter(mode: ConnectionMode, config: unknown): (JiraAdapter & { config: { site: string; projectKeys: string[] } }) | null {
  const parsed = jiraConnectionConfigSchema.safeParse(config);
  if (!parsed.success) return null;
  return mode === 'FIXTURE' ? new JiraFixtureAdapter(parsed.data) : new JiraLiveAdapter(parsed.data);
}
