import type { NormalizedEvidence, SourceIssue } from '@pactlab/domain';
import type { z } from 'zod';
import { VALUATION_DIRECTION_MAP } from '../valuation-direction';
import { MCP_SERVER_ID, type McpSession } from './types';

export type McpTarget = Readonly<Record<string, string>>;

export interface McpPull {
  readonly records: readonly NormalizedEvidence[];
  readonly issues: readonly SourceIssue[];
}

/**
 * How Pactlab reads one kind of MCP server (T-084c). A profile is code, reviewed like any
 * adapter: which tools it may call (read tools only), the headers it sends, the target it
 * reads, and how each tool's output becomes normalized evidence. Server output is
 * untrusted data — parsed against a schema, never treated as instructions.
 */
export interface McpEvidenceProfile<TTarget extends McpTarget = McpTarget> {
  /** The id an operator lists in `MCP_EVIDENCE_SERVERS` and a connection names. */
  readonly id: string;
  readonly label: string;
  /** The adapter version recorded on every sync run. */
  readonly version: string;
  /** The server's documented public endpoint, for the runbook; the operator's list decides. */
  readonly documentedUrl: string;
  readonly targetSchema: z.ZodType<TTarget>;
  /** Sent on every request, e.g. the server's own read-only switch. */
  readonly headers: Readonly<Record<string, string>>;
  /** The only tools Pactlab may call on this server. */
  readonly tools: readonly string[];
  /** What the credential must grant, in the provider's words, for the scopes check. */
  readonly requiredGrant: string;
  /** Every evidence type `pull` may emit; each must be in `VALUATION_DIRECTION_MAP`. */
  readonly evidenceTypes: readonly string[];
  describeTarget(target: TTarget): string;
  pull(session: McpSession, target: TTarget, context: { readonly site: string }): Promise<McpPull>;
}

/**
 * Register a profile. Refuses one that emits an evidence type with no valuation direction:
 * no evidence reaches a finding before its direction is decided and reviewed.
 */
export function defineMcpEvidenceProfile<TTarget extends McpTarget>(
  profile: McpEvidenceProfile<TTarget>,
): McpEvidenceProfile<TTarget> {
  if (!MCP_SERVER_ID.test(profile.id))
    throw new Error(`MCP profile id "${profile.id}" is not a valid id`);
  if (profile.tools.length === 0) throw new Error(`MCP profile ${profile.id} names no tools`);
  if (profile.evidenceTypes.length === 0)
    throw new Error(`MCP profile ${profile.id} emits no evidence`);
  for (const type of profile.evidenceTypes)
    if ((VALUATION_DIRECTION_MAP[type]?.length ?? 0) === 0)
      throw new Error(
        `MCP profile ${profile.id} emits ${type}, which has no VALUATION_DIRECTION_MAP entry`,
      );
  return profile;
}

/** Keep only the records a profile declared; anything else is a source issue, never evidence. */
export function declaredOnly(profile: McpEvidenceProfile, pull: McpPull): McpPull {
  const records = pull.records.filter((record) =>
    profile.evidenceTypes.includes(record.evidenceType),
  );
  const dropped = pull.records.length - records.length;
  return dropped === 0
    ? pull
    : {
        records,
        issues: [
          ...pull.issues,
          {
            dataset: profile.id,
            row: null,
            code: 'INVALID_VALUE',
            detail: `${dropped} record(s) of an undeclared evidence type were not kept`,
          },
        ],
      };
}
