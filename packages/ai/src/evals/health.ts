import type { ClaudeGateway } from '../gateway';
import { askDocuments } from '../grounding';
import { CONTRACT_PAGES } from './golden';

export interface ModelHealth {
  readonly passed: boolean;
  readonly latencyMs: number;
  /** Why it failed, in plain words; empty when it passed. */
  readonly failures: readonly string[];
}

/**
 * The model health check (Kumar, 2026-11-20: a check, not a gate on well-tested frontier models). One
 * synthetic question over the synthetic HealthyCo contract: the model must answer (our account can call
 * it), return Pactlab's structured answer (it follows the output format), and cite text that resolves to
 * the page word for word. How it phrases or how often it cites is not judged.
 */
export async function checkModelHealth(gateway: ClaudeGateway): Promise<ModelHealth> {
  const started = Date.now();
  const { result, providerError } = await askDocuments(gateway, {
    organizationId: '01920000-0000-7000-8000-0000000000a1',
    dealId: '01920000-0000-7000-8000-0000000000d1',
    question: { classification: 'BUSINESS', text: 'Can the customer terminate if the vendor is acquired?' },
    sources: CONTRACT_PAGES,
  });
  const latencyMs = Date.now() - started;
  const failures: string[] = [];
  if (providerError) failures.push(`The model could not be called (${providerError.toLowerCase()}).`);
  else if (result.status === 'FAILED') failures.push('The model did not return a valid structured answer.');
  else if (result.claims.length === 0) failures.push(`The model gave no cited answer (status ${result.status.toLowerCase()}).`);
  return { passed: failures.length === 0, latencyMs, failures };
}
