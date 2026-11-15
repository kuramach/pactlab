import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { AI_LOG } from './env';

/**
 * After every browser run (T-113): every AI request the API made was answered by the fixture provider.
 * Fails the run on anything else. The count goes to the console and the GitHub job summary.
 */
export default function aiProof(): void {
  const lines = existsSync(AI_LOG) ? readFileSync(AI_LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
  const requests = lines.map((line) => JSON.parse(line) as { provider?: string; live?: boolean; modelId?: string });
  const live = requests.filter((request) => request.provider !== 'fixture' || request.live !== false || request.modelId !== 'synthetic-fixture');
  const line = `AI requests this run: ${requests.length}, all answered by the fixture provider; live model calls: ${live.length}.`;
  process.stdout.write(`\n${line}\n`);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, `### AI in browser tests\n\n${line}\n`);
  if (live.length > 0) throw new Error(`${live.length} AI request(s) not served by the fixture provider: browser tests must never call a model.`);
}
