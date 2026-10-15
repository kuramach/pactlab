import { BedrockModelTransport, bedrockConverseSender, ModelProviderError, type ModelAlias } from '@pactlab/ai';
import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { routesFrom } from '../ai/ai-provider';

/**
 * Operator check: can this machine call each Claude model on Bedrock? One
 * tiny request per alias with a synthetic sentence — no documents, no deal
 * data. Run after `aws sso login`; never run in CI.
 */
const config = loadConfig(apiEnvSchema);
if (config.AI_PROVIDER !== 'bedrock' || !config.AWS_REGION) {
  process.stdout.write('AI is off: set AI_PROVIDER=bedrock and AWS_REGION (and AWS_PROFILE) in .env, then run `aws sso login`.\n');
  process.exit(1);
}
const transport = new BedrockModelTransport({ send: await bedrockConverseSender(config.AWS_REGION), maxRetries: 0, timeoutMs: 60_000 });
const routes = routesFrom(config);
let failed = 0;
process.stdout.write(`Bedrock in ${config.AWS_REGION}${process.env['AWS_PROFILE'] ? ` with profile ${process.env['AWS_PROFILE']}` : ''}\n`);
for (const alias of Object.keys(routes) as ModelAlias[]) {
  const route = routes[alias];
  const started = Date.now();
  try {
    const response = await transport.complete({
      modelId: route.modelId,
      effort: route.effort,
      system: 'You are a connectivity check. Reply with the single word OK.',
      messages: [{ role: 'user', content: 'Synthetic check: reply OK.' }],
      maxOutputTokens: 1024,
    });
    process.stdout.write(`  ✓ ${alias.padEnd(11)} ${route.modelId} — ${Date.now() - started} ms, ${response.inputTokens}+${response.outputTokens} tokens\n`);
  } catch (error) {
    failed += 1;
    const detail = error instanceof ModelProviderError ? `${error.kind}${error.providerCode ? ` (${error.providerCode})` : ''}: ${error.message}` : 'unexpected error';
    process.stdout.write(`  ✗ ${alias.padEnd(11)} ${route.modelId} — ${detail}\n`);
  }
}
process.exit(failed === 0 ? 0 : 1);
