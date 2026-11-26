import type { NormalizedEvidence, SourceIssue } from '@pactlab/domain';
import { z } from 'zod';
import { githubConnectionConfigSchema } from '../../github/types';
import { DEPENDENCY_ALERT_EVIDENCE_TYPE } from '../evidence-types';
import { defineMcpEvidenceProfile, type McpPull } from '../profile';
import type { McpSession } from '../types';

export const GITHUB_MCP_PROFILE_ID = 'github';
export const GITHUB_MCP_SOURCE_SYSTEM = 'mcp:github';
export const LIST_DEPENDABOT_ALERTS = 'list_dependabot_alerts';

/**
 * The tool's documented states (github/github-mcp-server `pkg/github/dependabot.go`:
 * open, fixed, dismissed, auto_dismissed; default open). There is no "all", so each is read.
 */
const ALERT_STATES = ['open', 'fixed', 'dismissed', 'auto_dismissed'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
/** Cursor pagination: `perPage` 1–100 and `after`, the previous page's `pageInfo.nextCursor`. */
const PER_PAGE = 100;
const MAX_PAGES_PER_STATE = 10;

export const githubMcpTargetSchema = z.strictObject({
  repository: githubConnectionConfigSchema.shape.repository,
});
export type GitHubMcpTarget = z.infer<typeof githubMcpTargetSchema>;

const text = (max: number) => z.string().max(max).nullish();

/**
 * The fields of a go-github `DependabotAlert` Pactlab keeps (the GitHub REST alert object).
 * Everything else is stripped on parse — notably `dismissed_by` (a person) and
 * `dismissed_comment` and advisory prose (free text from outside).
 */
const alertSchema = z.object({
  number: z.number().int().positive(),
  state: z.string().max(40),
  created_at: z.string().max(40),
  updated_at: text(40),
  fixed_at: text(40),
  dismissed_at: text(40),
  auto_dismissed_at: text(40),
  dismissed_reason: text(60),
  dependency: z
    .object({
      package: z.object({ ecosystem: text(60), name: text(200) }).nullish(),
      manifest_path: text(500),
      scope: text(40),
    })
    .nullish(),
  security_advisory: z
    .object({ ghsa_id: text(40), cve_id: text(40), severity: text(20) })
    .nullish(),
  security_vulnerability: z
    .object({
      severity: text(20),
      vulnerable_version_range: text(200),
      first_patched_version: z.object({ identifier: text(100) }).nullish(),
    })
    .nullish(),
});
type Alert = z.infer<typeof alertSchema>;

/** The tool's text result: `{"alerts": [...], "pageInfo": {"hasNextPage", "nextCursor", ...}}`. */
const pageSchema = z.object({
  alerts: z.array(z.unknown()).max(PER_PAGE),
  pageInfo: z
    .object({ hasNextPage: z.boolean(), nextCursor: z.string().max(500).optional() })
    .optional(),
});

// Control characters never survive into evidence, whatever a server sends.
const clean = (value: string | null | undefined) =>
  value
    ? [...value]
        .filter((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
        .join('')
        .trim() || null
    : null;
const isoOrNull = (value: string | null | undefined) =>
  value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const severityOf = (alert: Alert) => {
  const raw = (
    alert.security_vulnerability?.severity ??
    alert.security_advisory?.severity ??
    ''
  ).toLowerCase();
  return (SEVERITIES as readonly string[]).includes(raw) ? raw : null;
};

function normalize(
  alert: Alert,
  repository: string,
  site: string,
): NormalizedEvidence | SourceIssue {
  const createdAt = isoOrNull(alert.created_at);
  if (!createdAt)
    return {
      dataset: repository,
      row: null,
      code: 'INVALID_DATE',
      detail: `Alert ${alert.number} has no readable creation date`,
    };
  if (!(ALERT_STATES as readonly string[]).includes(alert.state))
    return {
      dataset: repository,
      row: null,
      code: 'INVALID_VALUE',
      detail: `Alert ${alert.number} has an unknown state`,
    };
  const canonical = {
    repository,
    alertNumber: String(alert.number),
    state: alert.state,
    severity: severityOf(alert),
    ecosystem: clean(alert.dependency?.package?.ecosystem),
    packageName: clean(alert.dependency?.package?.name),
    manifestPath: clean(alert.dependency?.manifest_path),
    dependencyScope: clean(alert.dependency?.scope),
    ghsaId: clean(alert.security_advisory?.ghsa_id),
    cveId: clean(alert.security_advisory?.cve_id),
    vulnerableRange: clean(alert.security_vulnerability?.vulnerable_version_range),
    firstPatchedVersion: clean(alert.security_vulnerability?.first_patched_version?.identifier),
    createdAt,
    fixedAt: isoOrNull(alert.fixed_at),
    dismissedAt: isoOrNull(alert.dismissed_at ?? alert.auto_dismissed_at),
    dismissedReason: clean(alert.dismissed_reason),
  };
  return {
    evidenceType: DEPENDENCY_ALERT_EVIDENCE_TYPE,
    sourceSystem: GITHUB_MCP_SOURCE_SYSTEM,
    sourceRecordId: `${repository}#dependabot-${alert.number}`,
    observedAt: isoOrNull(alert.updated_at) ?? createdAt,
    canonical,
    locator: {
      kind: 'provider_record',
      system: GITHUB_MCP_SOURCE_SYSTEM,
      site,
      resource: `${repository}/dependabot_alerts`,
      id: String(alert.number),
    },
    // The citation quotes the canonical record, as for imports: no unmapped server text becomes evidence.
    quote: JSON.stringify(canonical),
  };
}

function parsePage(texts: readonly string[]): z.infer<typeof pageSchema> | null {
  const [only] = texts;
  if (texts.length !== 1 || only === undefined) return null;
  try {
    const parsed = pageSchema.safeParse(JSON.parse(only));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function pull(
  session: McpSession,
  target: GitHubMcpTarget,
  context: { readonly site: string },
): Promise<McpPull> {
  const [owner, repo] = target.repository.split('/') as [string, string];
  const alerts = new Map<number, NormalizedEvidence>();
  const issues: SourceIssue[] = [];
  for (const state of ALERT_STATES) {
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_STATE; page += 1) {
      const result = await session.callTool(LIST_DEPENDABOT_ALERTS, {
        owner,
        repo,
        state,
        perPage: PER_PAGE,
        ...(after ? { after } : {}),
      });
      if (result.isError) {
        // The server's own words are untrusted and may echo the request; Pactlab says what it knows.
        issues.push({
          dataset: target.repository,
          row: null,
          code: 'PERMISSION_DENIED',
          detail: `The server refused to list ${state} Dependabot alerts; the credential needs security_events read access`,
        });
        break;
      }
      const parsed = parsePage(result.text);
      if (!parsed) {
        issues.push({
          dataset: target.repository,
          row: null,
          code: 'INVALID_VALUE',
          detail: `The ${state} alert page was not in the documented shape; nothing from it was kept`,
        });
        break;
      }
      for (const raw of parsed.alerts) {
        const alert = alertSchema.safeParse(raw);
        if (!alert.success) {
          issues.push({
            dataset: target.repository,
            row: null,
            code: 'INVALID_VALUE',
            detail: `An ${state} alert was not in the documented shape`,
          });
          continue;
        }
        const normalized = normalize(alert.data, target.repository, context.site);
        if ('evidenceType' in normalized) alerts.set(alert.data.number, normalized);
        else issues.push(normalized);
      }
      after = parsed.pageInfo?.hasNextPage ? parsed.pageInfo.nextCursor : undefined;
      if (!after) break;
      if (page === MAX_PAGES_PER_STATE - 1)
        issues.push({
          dataset: target.repository,
          row: null,
          code: 'INVALID_VALUE',
          detail: `More than ${PER_PAGE * MAX_PAGES_PER_STATE} ${state} alerts; the rest were not read`,
        });
    }
  }
  return {
    records: [...alerts.values()].sort(
      (a, b) => Number(a.canonical['alertNumber']) - Number(b.canonical['alertNumber']),
    ),
    issues,
  };
}

/**
 * The reference profile (T-084c): GitHub's own MCP server (github/github-mcp-server), read
 * for a repository's Dependabot alerts — dependency vulnerabilities the direct GitHub
 * adapter does not read. Remote endpoint `https://api.githubcopilot.com/mcp/`; the
 * operator should list the single-toolset, read-only path `/mcp/x/dependabot/readonly`.
 * The `X-MCP-Readonly` header asks for read tools only on any path. A personal access
 * token goes as `Authorization: Bearer`; the tool needs `security_events` read.
 */
export const GITHUB_MCP_PROFILE = defineMcpEvidenceProfile<GitHubMcpTarget>({
  id: GITHUB_MCP_PROFILE_ID,
  label: 'GitHub MCP server (Dependabot alerts)',
  version: 'mcp-github-1',
  documentedUrl: 'https://api.githubcopilot.com/mcp/x/dependabot/readonly',
  targetSchema: githubMcpTargetSchema,
  headers: { 'X-MCP-Readonly': 'true' },
  tools: [LIST_DEPENDABOT_ALERTS],
  requiredGrant: 'security_events read (a fine-grained token with Dependabot alerts: read)',
  evidenceTypes: [DEPENDENCY_ALERT_EVIDENCE_TYPE],
  describeTarget: (target) => target.repository,
  pull,
});
