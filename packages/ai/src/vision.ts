import type { AiRunRecord, ClaudeGateway, DataClassification } from './gateway';
import type { ModelProviderErrorKind } from './bedrock';
import { documentVisionPrompt, visionPageText, type DocumentVision } from './prompts/document-vision';
import type { ModelImage } from './transport';

/**
 * Read one page from its image (T-121). Returns the model's reading and the page text to store, or
 * null with the provider error when the call failed. The image carries its document's classification:
 * people data (HR, compensation) is refused by the gateway before any call.
 */
export async function readPageImage(
  gateway: ClaudeGateway,
  request: { organizationId: string; dealId: string; label: string; images: readonly ModelImage[]; classification: DataClassification },
): Promise<{ run: AiRunRecord; reading: DocumentVision | null; text: string | null; providerError: ModelProviderErrorKind | null }> {
  const response = await gateway.invoke(documentVisionPrompt, {
    organizationId: request.organizationId,
    dealId: request.dealId,
    inputs: [{ name: 'page', classification: 'BUSINESS', text: request.label }],
    images: request.images,
    imagesClassification: request.classification,
  });
  if (!response.output) return { run: response.run, reading: null, text: null, providerError: response.providerError };
  return { run: response.run, reading: response.output, text: visionPageText(response.output), providerError: null };
}
