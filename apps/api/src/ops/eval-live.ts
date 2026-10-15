import { BedrockModelTransport, bedrockConverseSender, defaultPromptRegistry, TransportClaudeGateway } from '@pactlab/ai';
import { runDocumentEvals } from '@pactlab/ai/evals';
import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { routesFrom } from '../ai/ai-provider';

/**
 * Operator-run: the synthetic golden set and injection probes against Claude
 * on Bedrock. Only the built-in synthetic contracts are sent; no deal data.
 * Never run in CI (outbound provider access is blocked there).
 */
const config = loadConfig(apiEnvSchema);
if (config.AI_PROVIDER !== 'bedrock' || !config.AWS_REGION) {
  process.stdout.write('AI is off: set AI_PROVIDER=bedrock and AWS_REGION, and run `aws sso login`.\n');
  process.exit(1);
}
const gateway = new TransportClaudeGateway({
  transport: new BedrockModelTransport({ send: await bedrockConverseSender(config.AWS_REGION) }),
  registry: defaultPromptRegistry(),
  routes: routesFrom(config),
});
const report = await runDocumentEvals({ live: gateway });
const pct = (value: number) => `${Math.round(value * 100)}%`;
for (const row of [...report.golden, ...report.probes]) {
  process.stdout.write(`  ${row.passed ? '✓' : '✗'} ${row.id.padEnd(40)} ${row.correctCitations}/${row.expectedCitations} citations · ${row.detail}\n`);
}
process.stdout.write(
  `\nGolden: ${report.golden.filter((row) => row.passed).length}/${report.golden.length} passed · citation recall ${pct(report.citationRecall)} · precision ${pct(report.citationPrecision)}\n` +
    `Probes blocked: ${report.probesBlocked}/${report.probes.length}\n`,
);
process.exit(report.golden.every((row) => row.passed) && report.probesBlocked === report.probes.length ? 0 : 1);
