import { contractExtractionPrompt } from './contract-extract';
import { documentQaPrompt } from './document-qa';
import { PromptRegistry } from './registry';

export * from './contract-extract';
export * from './document-qa';
export * from './registry';

/** The registry of prompts approved to run. */
export function defaultPromptRegistry(): PromptRegistry {
  return new PromptRegistry().register(documentQaPrompt).register(contractExtractionPrompt);
}
