import { contractExtractionPrompt } from './contract-extract';
import { contractScrubPrompt } from './contract-scrub';
import { documentClassificationPrompt } from './document-classify';
import { documentQaPrompt } from './document-qa';
import { documentVisionPrompt } from './document-vision';
import { importMappingPrompt } from './import-map';
import { foresightForecastPrompt, foresightQaPrompt, foresightTrendsPrompt } from './foresight';
import { negotiationBriefPrompt } from './negotiation-brief';
import { PromptRegistry } from './registry';

export * from './contract-extract';
export * from './contract-scrub';
export * from './document-classify';
export * from './document-qa';
export * from './document-vision';
export * from './foresight';
export * from './import-map';
export * from './negotiation-brief';
export * from './registry';

/** The registry of prompts approved to run. */
export function defaultPromptRegistry(): PromptRegistry {
  return new PromptRegistry().register(documentQaPrompt).register(contractExtractionPrompt).register(foresightTrendsPrompt).register(foresightQaPrompt).register(foresightForecastPrompt).register(documentClassificationPrompt).register(negotiationBriefPrompt).register(contractScrubPrompt).register(documentVisionPrompt).register(importMappingPrompt);
}
