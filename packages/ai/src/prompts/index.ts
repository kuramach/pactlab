import { contractExtractionPrompt } from './contract-extract';
import { documentClassificationPrompt } from './document-classify';
import { documentQaPrompt } from './document-qa';
import { foresightForecastPrompt, foresightQaPrompt, foresightTrendsPrompt } from './foresight';
import { PromptRegistry } from './registry';

export * from './contract-extract';
export * from './document-classify';
export * from './document-qa';
export * from './foresight';
export * from './registry';

/** The registry of prompts approved to run. */
export function defaultPromptRegistry(): PromptRegistry {
  return new PromptRegistry().register(documentQaPrompt).register(contractExtractionPrompt).register(foresightTrendsPrompt).register(foresightQaPrompt).register(foresightForecastPrompt).register(documentClassificationPrompt);
}
