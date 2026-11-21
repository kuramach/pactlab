import { describe, expect, it } from 'vitest';
import { defaultPromptRegistry } from '../prompts';
import { TransportClaudeGateway } from '../gateway';
import { ScriptedModelTransport } from '../transport';
import { EXTRACTION_PROBES, PAGE_IDS, QA_CASES, QA_PROBES } from './golden';
import { judgeModel, runDocumentEvals, runQa } from './run';

/**
 * Document AI evaluation suite (runs in CI with `pnpm test`, provider access
 * blocked). Gates: exact citation accuracy on the golden set and every
 * citation-mismatch / prompt-injection probe blocked.
 */
describe('document AI evals', async () => {
  const report = await runDocumentEvals();

  it('replays cassettes recorded for the current prompt versions', () => {
    expect(
      report.staleCassettes,
      `Prompt changed; re-record cassettes. Current hashes: ${JSON.stringify(defaultPromptRegistry().list())}`,
    ).toEqual([]);
  });

  it.each(report.golden.map((row) => [row.id, row] as const))('golden %s', (_id, row) => {
    expect(row.passed, row.detail).toBe(true);
  });

  it('cites the exact expected page for every golden claim', () => {
    expect(report.citationRecall).toBe(1);
    expect(report.citationPrecision).toBe(1);
  });

  it.each(report.probes.map((row) => [row.id, row] as const))('probe %s is blocked', (_id, row) => {
    expect(row.passed, row.detail).toBe(true);
  });

  it('blocks every probe', () => {
    expect(report.probesBlocked).toBe(QA_PROBES.length + EXTRACTION_PROBES.length);
  });
});

describe('the bar a model must clear to serve (T-131)', () => {
  it('passes the recorded cassettes and fails a model that misses a case, a probe or citations', async () => {
    const report = await runDocumentEvals();
    expect(judgeModel(report)).toEqual({ passed: true, failures: [] });
    const missed = { ...report, golden: report.golden.map((row, index) => (index === 0 ? { ...row, passed: false, detail: 'wrong value' } : row)), citationRecall: 0.8 };
    const verdict = judgeModel(missed);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/golden .*wrong value.*citation recall 0\.80 < 0\.9/);
    expect(judgeModel({ ...report, probes: report.probes.map((row) => ({ ...row, passed: false })) }).passed).toBe(false);
  });
});

describe('a live model is judged on the pages it cites, not how many times (2026-11-20)', () => {
  // Opus 5.5 failed qa.change-of-control on live with a right answer and nothing rejected: live answers
  // may split or join sentences, so the count of citations to the right page differs from the recording.
  const coc = QA_CASES.find((test) => test.id === 'qa.change-of-control')!;
  const live = (claims: { statement: string; page: string; quote: string }[]) =>
    new TransportClaudeGateway({
      transport: new ScriptedModelTransport(() =>
        JSON.stringify({ unanswerable: false, answer: 'Yes, within six months on 30 days notice.', claims: claims.map((c) => ({ statement: c.statement, citations: [{ citationId: c.page, quote: c.quote }] })) }),
      ),
      registry: defaultPromptRegistry(),
    });
  const p3 = { page: PAGE_IDS.p3, quote: "If Vendor undergoes a Change of Control, Customer may terminate this Agreement upon thirty (30) days' written notice" };

  it('passes with the right page cited once, twice or three times', async () => {
    for (const n of [1, 2, 3]) {
      const row = await runQa(coc, () => live(Array.from({ length: n }, (_, i) => ({ statement: `Claim ${i + 1}.`, ...p3 }))), true);
      expect(row.passed, row.detail).toBe(true);
    }
  });

  it('still fails when a page outside the expected ones is cited, and says which pages', async () => {
    const row = await runQa(coc, () => live([{ statement: 'Claim.', ...p3 }, { statement: 'Term.', page: PAGE_IDS.p1, quote: 'The initial term of this Agreement is thirty-six (36) months' }]), true);
    expect(row.passed).toBe(false);
    expect(row.detail).toContain('pages expected=[3,3] cited=[3,1]');
  });

  it('counts distinct pages for recall and precision, so repeats are not extras (Opus: recall 100%, precision 49%)', async () => {
    const row = await runQa(coc, () => live([{ statement: 'Claim one.', ...p3 }, { statement: 'Claim two.', ...p3 }, { statement: 'Claim three.', ...p3 }, { statement: 'Claim four.', ...p3 }]), true);
    expect(row).toMatchObject({ passed: true, expectedCitations: 1, correctCitations: 1, groundedCitations: 1 });
  });

  it('recorded answers stay exact', async () => {
    const row = await runQa(coc, () => live([{ statement: 'Claim.', ...p3 }]), false);
    expect(row.passed).toBe(false);
  });
});
