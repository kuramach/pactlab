import { JIRA_HOST } from './types';

/**
 * Which Jira hosts a deployment may reach (T-082). Atlassian Cloud sites are
 * always allowed; a self-hosted server only when the operator lists its host
 * in platform configuration (`JIRA_SELF_HOSTED_HOSTS`) — never a value a deal
 * user can type.
 */
export interface JiraSitePolicy {
  readonly selfHostedHosts: readonly string[];
}

export const CLOUD_ONLY: JiraSitePolicy = { selfHostedHosts: [] };

export const isJiraCloudHost = (site: string) => /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/.test(site);

/** Parse the operator's comma-separated host list; throws on anything that is not a plain host name. */
export function parseSelfHostedHosts(raw: string | undefined): string[] {
  const hosts = (raw ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const host of hosts) if (!JIRA_HOST.test(host) || isJiraCloudHost(host)) throw new Error(`JIRA_SELF_HOSTED_HOSTS: "${host}" is not a self-hosted host name`);
  return [...new Set(hosts)];
}

/** Null when the site may be reached; otherwise the reason, safe to show the deal lead. */
export function jiraSiteProblem(site: string, policy: JiraSitePolicy): string | null {
  if (!JIRA_HOST.test(site)) return `${site} is not a valid Jira host name`;
  if (isJiraCloudHost(site) || policy.selfHostedHosts.includes(site)) return null;
  return `${site} is not on this deployment's approved Jira servers; ask your Pactlab operator to add it`;
}
