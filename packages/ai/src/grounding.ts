import { groundItems, SourceIndex, type CitationFailure, type ResolvedCitation } from './citations';
import type { CitableSource } from './context';
import type { AiRunRecord, ClaudeGateway, GatewayInput } from './gateway';
import type { ModelAlias } from './models';
import { contractExtractionPrompt, documentQaPrompt, type ContractExtraction } from './prompts';

interface Scope {
  readonly organizationId: string;
  readonly dealId: string;
  readonly modelAlias?: ModelAlias;
}

export type AnswerStatus = 'ANSWERED' | 'PARTIAL' | 'UNANSWERABLE' | 'UNSUPPORTED' | 'FAILED';

export interface GroundedClaim {
  readonly statement: string;
  readonly citations: readonly ResolvedCitation[];
}

export interface RejectedClaim {
  readonly statement: string;
  readonly reasons: readonly CitationFailure[];
}

export interface GroundedAnswer {
  readonly status: AnswerStatus;
  /** Model prose, shown only when every claim resolved. */
  readonly answer: string | null;
  readonly claims: readonly GroundedClaim[];
  readonly rejectedClaims: readonly RejectedClaim[];
}

/**
 * Document Q&A: the model answers over the supplied pages; only claims whose
 * citations all resolve to those exact pages are returned.
 */
export async function askDocuments(
  gateway: ClaudeGateway,
  request: Scope & { readonly question: GatewayInput; readonly sources: readonly CitableSource[] },
): Promise<{ run: AiRunRecord; result: GroundedAnswer }> {
  const response = await gateway.invoke(documentQaPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [{ ...request.question, name: 'question' }],
    sources: request.sources,
  });
  const empty = { answer: null, claims: [], rejectedClaims: [] };
  if (!response.output) return { run: response.run, result: { status: 'FAILED', ...empty } };
  const output = response.output;
  const { grounded, rejected } = groundItems(output.claims, new SourceIndex(request.sources));
  const claims = grounded.map(({ item, citations }) => ({ statement: item.statement, citations }));
  const rejectedClaims = rejected.map(({ item, reasons }) => ({
    statement: item.statement,
    reasons,
  }));
  const status: AnswerStatus =
    output.unanswerable && output.claims.length === 0
      ? 'UNANSWERABLE'
      : claims.length === 0
        ? 'UNSUPPORTED'
        : rejectedClaims.length > 0
          ? 'PARTIAL'
          : 'ANSWERED';
  return {
    run: response.run,
    result: {
      status,
      answer: status === 'ANSWERED' || status === 'UNANSWERABLE' ? output.answer : null,
      claims,
      rejectedClaims,
    },
  };
}

export type ExtractedKind = 'PARTY' | 'DATE' | 'CLAUSE';

/** A typed extraction item that may become a draft finding. */
export interface ExtractedItem {
  readonly kind: ExtractedKind;
  readonly subtype: string;
  readonly title: string;
  readonly summary: string;
  readonly severity: ContractExtraction['clauses'][number]['severity'];
  readonly citations: readonly ResolvedCitation[];
}

const humanize = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');

/**
 * Contract extraction: parties, dates and key clauses. Items with any
 * unresolved citation are dropped and reported, never drafted.
 */
export async function extractContractTerms(
  gateway: ClaudeGateway,
  request: Scope & { readonly sources: readonly CitableSource[] },
): Promise<{
  run: AiRunRecord;
  items: ExtractedItem[];
  rejected: { title: string; reasons: readonly CitationFailure[] }[];
}> {
  const response = await gateway.invoke(contractExtractionPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [],
    sources: request.sources,
  });
  if (!response.output) return { run: response.run, items: [], rejected: [] };
  const { parties, dates, clauses } = response.output;
  const candidates = [
    ...parties.map((p) => ({
      kind: 'PARTY' as const,
      subtype: 'PARTY',
      title: `Party: ${p.name}`,
      summary: `${p.name} — ${p.role}`,
      severity: 'INFO' as const,
      citations: p.citations,
    })),
    ...dates.map((d) => ({
      kind: 'DATE' as const,
      subtype: d.kind,
      title: `${humanize(d.kind)} date: ${d.date}`,
      summary: `${humanize(d.kind)} date ${d.date}`,
      severity: 'INFO' as const,
      citations: d.citations,
    })),
    ...clauses.map((c) => ({
      kind: 'CLAUSE' as const,
      subtype: c.kind,
      title: `${humanize(c.kind)} clause`,
      summary: c.summary,
      severity: c.severity,
      citations: c.citations,
    })),
  ];
  const { grounded, rejected } = groundItems(candidates, new SourceIndex(request.sources));
  return {
    run: response.run,
    items: grounded.map(({ item, citations }) => ({ ...item, citations })),
    rejected: rejected.map(({ item, reasons }) => ({ title: item.title, reasons })),
  };
}
