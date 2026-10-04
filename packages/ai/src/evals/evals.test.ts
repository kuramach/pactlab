import { describe, expect, it } from 'vitest';
import { defaultPromptRegistry } from '../prompts';
import { QA_PROBES, EXTRACTION_PROBES } from './golden';
import { runDocumentEvals } from './run';

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
