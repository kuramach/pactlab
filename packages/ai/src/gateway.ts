import { z } from 'zod';

/**
 * Data classifications that may never reach a model or embedding call
 * (CLAUDE.md rule 7). The gateway enforces this before any provider call.
 */
export const PROHIBITED_CLASSIFICATIONS = [
  'HR',
  'COMPENSATION',
  'PERFORMANCE',
  'NAMED_CONTRIBUTION',
] as const;

export const DATA_CLASSIFICATIONS = ['PUBLIC', 'BUSINESS', 'FINANCIAL', ...PROHIBITED_CLASSIFICATIONS] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const modelAliasSchema = z.enum(['reasoning', 'extraction', 'fast']);
export type ModelAlias = z.infer<typeof modelAliasSchema>;

export interface GatewayRequest {
  readonly organizationId: string;
  readonly dealId: string;
  readonly taskType: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly modelAlias: ModelAlias;
  /** Every input part declares its classification; unclassified input is rejected. */
  readonly inputs: readonly { readonly classification: DataClassification; readonly text: string }[];
}

export interface GatewayResponse {
  readonly aiRunId: string;
  readonly resolvedModelId: string;
  /** Untrusted until schema-validated and every citation resolves. */
  readonly output: unknown;
}

/** Claude assists; it never approves findings, sets price or makes legal conclusions. */
export interface ClaudeGateway {
  invoke(request: GatewayRequest): Promise<GatewayResponse>;
}

export class GatewayPolicyError extends Error {
  constructor(readonly code: 'PROHIBITED_DATA' | 'NOT_CONFIGURED') {
    super(code === 'PROHIBITED_DATA' ? 'Request contains data classes that may not be sent to a model' : 'AI gateway is not configured');
    this.name = 'GatewayPolicyError';
  }
}

export function assertModelSafeInputs(request: GatewayRequest): void {
  const prohibited = new Set<string>(PROHIBITED_CLASSIFICATIONS);
  if (request.inputs.some((input) => prohibited.has(input.classification))) {
    throw new GatewayPolicyError('PROHIBITED_DATA');
  }
}

/**
 * Placeholder until the Bedrock-backed gateway lands (MVP increment 5).
 * Applies the data policy first so the guard is exercised from day one.
 */
export class NotConfiguredClaudeGateway implements ClaudeGateway {
  async invoke(request: GatewayRequest): Promise<GatewayResponse> {
    assertModelSafeInputs(request);
    throw new GatewayPolicyError('NOT_CONFIGURED');
  }
}
