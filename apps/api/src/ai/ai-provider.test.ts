import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAiGateway, LoggedFixtureTransport } from './ai-provider';

const dir = mkdtempSync(join(tmpdir(), 'pactlab-ai-fixture-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the fixture AI provider (T-113)', () => {
  it('answers from scripts, and logs each request without its content', async () => {
    const log = join(dir, 'requests.jsonl');
    const transport = new LoggedFixtureTransport(log);
    const response = await transport.complete({
      modelId: 'synthetic-fixture',
      effort: 'low',
      system: 'You give a five-year forecast for each economic or sector metric you are asked about.',
      messages: [{ role: 'user', content: 'inflation: Inflation (consumer prices) (percent a year)\nSECRET-DEAL-TEXT' }],
      maxOutputTokens: 100,
    });
    expect(JSON.parse(response.text)).toMatchObject({ metrics: [{ key: 'inflation', values: [2, 2, 2, 2, 2] }] });
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ provider: 'fixture', modelId: 'synthetic-fixture', live: false });
    expect(lines[0]).not.toContain('SECRET-DEAL-TEXT');
  });

  it('is what AI_PROVIDER=fixture gives: AI on, as "synthetic", with no model', async () => {
    const { status } = await createAiGateway({ AI_PROVIDER: 'fixture', AI_FIXTURE_LOG: join(dir, 'other.jsonl') } as never);
    expect(status).toMatchObject({ enabled: true, provider: 'synthetic', region: null });
    expect(status.routes.every((route) => route.modelId === 'synthetic-fixture')).toBe(true);
  });
});
