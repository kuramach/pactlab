import { describe, expect, it } from 'vitest';
import { TransportClaudeGateway } from '../../gateway';
import { scrubContract } from '../../grounding';
import { defaultPromptRegistry } from '../../prompts';
import { ScriptedModelTransport } from '../../transport';
import { SCRUB_CASES, SCRUB_PROBES, type ScrubCase } from './scrub';

const SCOPE = { organizationId: '01920000-0000-7000-8000-0000000000a1', dealId: '01920000-0000-7000-8000-0000000000d1' };

async function run(test: ScrubCase) {
  const transport = new ScriptedModelTransport((_request, call) => test.responses[Math.min(call, test.responses.length - 1)] ?? '');
  const gateway = new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() });
  return scrubContract(gateway, { ...SCOPE, sources: test.sources });
}

describe('consistency checks smoke set (T-132)', () => {
  it.each(SCRUB_CASES)('$id: drafts exactly the known problems, each cited on the right pages', async (test) => {
    const { run: record, items, rejected } = await run(test);
    expect(record.jobType).toBe('contract_scrub');
    expect(rejected).toEqual([]);
    expect(items.map((item) => ({ kind: item.subtype, pages: item.citations.map((c) => c.pageNumber) }))).toEqual(test.expect);
    for (const item of items) expect(item.kind).toBe('CONSISTENCY');
  });

  it.each(SCRUB_PROBES)('$id: an invented problem with a quote not in the file is never drafted', async (test) => {
    const { items, rejected } = await run(test);
    expect(items).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
});
