import { TransportClaudeGateway } from '../gateway';
import { askDocuments, extractContractTerms } from '../grounding';
import { defaultPromptRegistry } from '../prompts';
import { ScriptedModelTransport } from '../transport';
import {
  CASSETTE_PROMPTS,
  EXTRACTION_CASES,
  EXTRACTION_PROBES,
  QA_CASES,
  QA_PROBES,
  type ExtractionCase,
  type QaCase,
} from './golden';

const SCOPE = {
  organizationId: '01920000-0000-7000-8000-0000000000a1',
  dealId: '01920000-0000-7000-8000-0000000000d1',
};

export interface CaseResult {
  readonly id: string;
  readonly passed: boolean;
  readonly expectedCitations: number;
  readonly correctCitations: number;
  readonly groundedCitations: number;
  readonly detail: string;
}

export interface EvalReport {
  readonly cassettesCurrent: boolean;
  readonly staleCassettes: readonly string[];
  readonly golden: readonly CaseResult[];
  readonly probes: readonly CaseResult[];
  /** Expected citations reproduced on the right page / expected citations. */
  readonly citationRecall: number;
  /** Grounded citations on an expected page / grounded citations. */
  readonly citationPrecision: number;
  readonly probesBlocked: number;
}

function replay(responses: readonly string[]) {
  const transport = new ScriptedModelTransport(
    (_request, call) => responses[Math.min(call, responses.length - 1)] ?? '',
  );
  return new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() });
}

/** Multiset comparison of grounded vs expected page numbers. */
function score(expected: readonly number[], actual: readonly number[]) {
  const remaining = [...expected];
  let correct = 0;
  for (const pageNumber of actual) {
    const at = remaining.indexOf(pageNumber);
    if (at !== -1) {
      remaining.splice(at, 1);
      correct += 1;
    }
  }
  return correct;
}

async function runQa(test: QaCase): Promise<CaseResult> {
  const { result } = await askDocuments(replay(test.responses), {
    ...SCOPE,
    question: { classification: 'BUSINESS', text: test.question },
    sources: test.sources,
  });
  const pages = result.claims.flatMap((claim) => claim.citations.map((c) => c.pageNumber));
  const correct = score(test.expectPages, pages);
  const allowed = test.allowedStatements;
  const leaked = allowed ? result.claims.filter((c) => !allowed.includes(c.statement)) : [];
  const passed =
    result.status === test.expectStatus &&
    correct === test.expectPages.length &&
    pages.length === test.expectPages.length &&
    leaked.length === 0;
  return {
    id: test.id,
    passed,
    expectedCitations: test.expectPages.length,
    correctCitations: correct,
    groundedCitations: pages.length,
    detail: `status=${result.status} rejected=${result.rejectedClaims.map((r) => r.reasons.join('+')).join(',')}`,
  };
}

async function runExtraction(test: ExtractionCase): Promise<CaseResult> {
  const { items, rejected } = await extractContractTerms(replay(test.responses), {
    ...SCOPE,
    sources: test.sources,
  });
  const expected = Object.entries(test.expectItems);
  const correct = expected.filter(([title, pageNumber]) =>
    items.some(
      (item) => item.title === title && item.citations.every((c) => c.pageNumber === pageNumber),
    ),
  ).length;
  const grounded = items.reduce((n, item) => n + item.citations.length, 0);
  return {
    id: test.id,
    passed: correct === expected.length && items.length === expected.length,
    expectedCitations: expected.length,
    correctCitations: correct,
    groundedCitations: grounded,
    detail: `drafted=${items.length} rejected=${rejected.map((r) => r.reasons.join('+')).join(',')}`,
  };
}

/** Runs the golden set and probes through the real gateway and grounding path. */
export async function runDocumentEvals(): Promise<EvalReport> {
  const registry = defaultPromptRegistry();
  const staleCassettes = Object.entries(CASSETTE_PROMPTS)
    .filter(([key, hash]) => {
      const [id, version] = key.split('@') as [string, string];
      const prompt = registry.get(id, version);
      return !prompt || registry.hashOf(prompt) !== hash;
    })
    .map(([key]) => key);

  const golden = [
    ...(await Promise.all(QA_CASES.map(runQa))),
    ...(await Promise.all(EXTRACTION_CASES.map(runExtraction))),
  ];
  const probes = [
    ...(await Promise.all(QA_PROBES.map(runQa))),
    ...(await Promise.all(EXTRACTION_PROBES.map(runExtraction))),
  ];
  const sum = (rows: readonly CaseResult[], key: keyof CaseResult) =>
    rows.reduce((n, row) => n + (row[key] as number), 0);
  const expected = sum(golden, 'expectedCitations');
  const grounded = sum(golden, 'groundedCitations');
  const correct = sum(golden, 'correctCitations');
  return {
    cassettesCurrent: staleCassettes.length === 0,
    staleCassettes,
    golden,
    probes,
    citationRecall: expected === 0 ? 1 : correct / expected,
    citationPrecision: grounded === 0 ? 1 : correct / grounded,
    probesBlocked: probes.filter((p) => p.passed).length,
  };
}
