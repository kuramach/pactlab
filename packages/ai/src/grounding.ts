import { groundItems, SourceIndex, type CitationFailure, type ResolvedCitation } from './citations';
import type { CitableSource } from './context';
import type { ModelProviderErrorKind } from './bedrock';
import type { AiRunRecord, ClaudeGateway, GatewayInput } from './gateway';
import type { ModelAlias } from './models';
import { contractExtractionPrompt, contractScrubPrompt, documentQaPrompt, documentUnderstandingPrompt, musicExtractionPrompt, offeringExtractionPrompt, type ContractExtraction, type DocumentUnderstanding, type MusicExtraction, type OfferingExtraction } from './prompts';

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
): Promise<{ run: AiRunRecord; result: GroundedAnswer; providerError: ModelProviderErrorKind | null }> {
  const response = await gateway.invoke(documentQaPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [{ ...request.question, name: 'question' }],
    sources: request.sources,
  });
  const empty = { answer: null, claims: [], rejectedClaims: [] };
  if (!response.output) return { run: response.run, result: { status: 'FAILED', ...empty }, providerError: response.providerError };
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
    providerError: null,
    result: {
      status,
      answer: status === 'ANSWERED' || status === 'UNANSWERABLE' ? output.answer : null,
      claims,
      rejectedClaims,
    },
  };
}

/** CONSISTENCY: a drafting problem from the consistency checks (T-132). */
export type ExtractedKind = 'PARTY' | 'DATE' | 'CLAUSE' | 'CONSISTENCY';

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
  request: Scope & { readonly sources: readonly CitableSource[]; readonly guidance?: string | null },
): Promise<{
  run: AiRunRecord;
  items: ExtractedItem[];
  rejected: { title: string; reasons: readonly CitationFailure[] }[];
  /** Why the provider call failed, when it did (never content). */
  providerError: ModelProviderErrorKind | null;
}> {
  const response = await gateway.invoke(contractExtractionPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: request.guidance ? [{ name: 'guidance', classification: 'BUSINESS', text: request.guidance }] : [],
    sources: request.sources,
  });
  if (!response.output) return { run: response.run, items: [], rejected: [], providerError: response.providerError };
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
    providerError: null,
    items: grounded.map(({ item, citations }) => ({ ...item, citations })),
    rejected: rejected.map(({ item, reasons }) => ({ title: item.title, reasons })),
  };
}

/** A document as the reader understood it: every section and kind grounded on a page; ungrounded ones dropped. */
export interface GroundedUnderstanding {
  readonly documentType: string;
  readonly summary: string;
  readonly sections: readonly { title: string; citations: readonly ResolvedCitation[] }[];
  readonly willExtract: readonly { kind: DocumentUnderstanding['willExtract'][number]['kind']; note: string; citations: readonly ResolvedCitation[] }[];
  readonly questions: readonly { question: string; citations: readonly ResolvedCitation[] }[];
}

/**
 * Read a document before extracting (Kumar, 2026-11-25): how it is set up, what will be drafted, and what the reader
 * needs from a person. Sections and kinds whose citations do not resolve are dropped; a question keeps only the
 * citations that resolve (it may have none: "Schedule 3 is not included").
 */
export async function understandDocument(
  gateway: ClaudeGateway,
  request: Scope & { readonly sources: readonly CitableSource[] },
): Promise<{ run: AiRunRecord; understanding: GroundedUnderstanding | null; providerError: ModelProviderErrorKind | null }> {
  const response = await gateway.invoke(documentUnderstandingPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [],
    sources: request.sources,
  });
  if (!response.output) return { run: response.run, understanding: null, providerError: response.providerError };
  const index = new SourceIndex(request.sources);
  const output = response.output;
  const sections = groundItems(output.sections, index).grounded.map(({ item, citations }) => ({ title: item.title, citations }));
  const willExtract = groundItems(output.willExtract, index).grounded.map(({ item, citations }) => ({ kind: item.kind, note: item.note, citations }));
  const questions = output.questions.map((question) => ({
    question: question.question,
    citations: question.citations.flatMap((citation) => {
      const check = index.verify(citation);
      return check.ok ? [check.citation] : [];
    }),
  }));
  return { run: response.run, providerError: null, understanding: { documentType: output.documentType, summary: output.summary, sections, willExtract, questions } };
}

/**
 * Consistency checks on an agreement (T-132): defined terms, cross-references, party names and
 * contradictions. As with extraction, an item with any unresolved citation is dropped and reported.
 */
export async function scrubContract(
  gateway: ClaudeGateway,
  request: Scope & { readonly sources: readonly CitableSource[] },
): Promise<{
  run: AiRunRecord;
  items: ExtractedItem[];
  rejected: { title: string; reasons: readonly CitationFailure[] }[];
  providerError: ModelProviderErrorKind | null;
}> {
  const response = await gateway.invoke(contractScrubPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [],
    sources: request.sources,
  });
  if (!response.output) return { run: response.run, items: [], rejected: [], providerError: response.providerError };
  const candidates = response.output.findings.map((f) => ({
    kind: 'CONSISTENCY' as const,
    subtype: f.kind,
    title: f.title,
    summary: f.explanation,
    severity: f.severity,
    citations: f.citations,
  }));
  const { grounded, rejected } = groundItems(candidates, new SourceIndex(request.sources));
  return {
    run: response.run,
    providerError: null,
    items: grounded.map(({ item, citations }) => ({ ...item, citations })),
    rejected: rejected.map(({ item, reasons }) => ({ title: item.title, reasons })),
  };
}

/** Why an offering item was dropped: its citation did not resolve, or a figure is not in its quote. */
export type OfferingRejection = CitationFailure | 'FIGURE_NOT_IN_QUOTE';

export interface ExtractedOfferingItem {
  readonly kind: OfferingExtraction['items'][number]['kind'];
  readonly label: string | null;
  readonly value: string | null;
  readonly hurdle: string | null;
  readonly citation: ResolvedCitation;
}

/** The numbers written in a quote ("1,250,000", "8%", "1.85x"), as canonical decimals. */
export function figuresIn(quote: string): Set<string> {
  const found = new Set<string>();
  for (const match of quote.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) found.add(canonicalFigure(match[0].replaceAll(',', '')));
  return found;
}

const canonicalFigure = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text).replace(/^0+(?=\d)/, '');

/**
 * Offering extraction (T-106): the model proposes fees, distribution terms and claims; code
 * keeps an item only when its quote is on the cited page and every figure it gives (value and
 * hurdle) is written in that quote. Everything kept is a draft for the sponsor to confirm.
 */
export async function extractOfferingItems(
  gateway: ClaudeGateway,
  request: Scope & { readonly sources: readonly CitableSource[] },
): Promise<{
  run: AiRunRecord;
  items: ExtractedOfferingItem[];
  rejected: { kind: string; reasons: readonly OfferingRejection[] }[];
  providerError: ModelProviderErrorKind | null;
}> {
  const response = await gateway.invoke(offeringExtractionPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [],
    sources: request.sources,
  });
  if (!response.output) return { run: response.run, items: [], rejected: [], providerError: response.providerError };
  const { grounded, rejected } = groundItems(response.output.items, new SourceIndex(request.sources));
  const items: ExtractedOfferingItem[] = [];
  const dropped: { kind: string; reasons: readonly OfferingRejection[] }[] = rejected.map(({ item, reasons }) => ({ kind: item.kind, reasons }));
  for (const { item, citations } of grounded) {
    const written = new Set(citations.flatMap((citation) => [...figuresIn(citation.quote)]));
    const figures = [item.value, item.hurdle].filter((figure): figure is string => figure !== null);
    if (figures.some((figure) => !written.has(canonicalFigure(figure)))) {
      dropped.push({ kind: item.kind, reasons: ['FIGURE_NOT_IN_QUOTE'] });
      continue;
    }
    const [citation] = citations;
    if (!citation) continue;
    items.push({ kind: item.kind, label: item.label, value: item.value, hurdle: item.hurdle, citation });
  }
  return { run: response.run, items, rejected: dropped, providerError: null };
}

export interface ExtractedMusicItem {
  readonly kind: MusicExtraction['items'][number]['kind'];
  readonly work: string | null;
  readonly detail: string | null;
  readonly value: string | null;
  readonly date: string | null;
  readonly citation: ResolvedCitation;
}

/**
 * Music rights extraction (T-140): the model proposes register entries; code keeps one only when
 * its quote is on the cited page, its figure is written in that quote and the year of its date
 * appears there too. Everything kept is a draft for a person to confirm.
 */
export async function extractMusicItems(
  gateway: ClaudeGateway,
  request: Scope & { readonly sources: readonly CitableSource[] },
): Promise<{
  run: AiRunRecord;
  items: ExtractedMusicItem[];
  rejected: { kind: string; reasons: readonly OfferingRejection[] }[];
  providerError: ModelProviderErrorKind | null;
}> {
  const response = await gateway.invoke(musicExtractionPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    modelAlias: request.modelAlias,
    inputs: [],
    sources: request.sources,
  });
  if (!response.output) return { run: response.run, items: [], rejected: [], providerError: response.providerError };
  const { grounded, rejected } = groundItems(response.output.items, new SourceIndex(request.sources));
  const items: ExtractedMusicItem[] = [];
  const dropped: { kind: string; reasons: readonly OfferingRejection[] }[] = rejected.map(({ item, reasons }) => ({ kind: item.kind, reasons }));
  for (const { item, citations } of grounded) {
    const written = new Set(citations.flatMap((citation) => [...figuresIn(citation.quote)]));
    const figures = [item.value, item.date ? item.date.slice(0, 4) : null].filter((figure): figure is string => figure !== null);
    if (figures.some((figure) => !written.has(canonicalFigure(figure)))) {
      dropped.push({ kind: item.kind, reasons: ['FIGURE_NOT_IN_QUOTE'] });
      continue;
    }
    const [citation] = citations;
    if (!citation) continue;
    items.push({ kind: item.kind, work: item.work, detail: item.detail, value: item.value, date: item.date, citation });
  }
  return { run: response.run, items, rejected: dropped, providerError: null };
}
