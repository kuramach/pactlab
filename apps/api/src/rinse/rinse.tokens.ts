import type { ClaudeGateway } from '@pactlab/ai';
import type { PactlabTokens } from '../auth/pactlab-token';
import type { EmailSender } from '../email-login/email-sender';

export const RINSE_DEPENDENCIES = Symbol('RINSE_DEPENDENCIES');

export interface RinseDependencies {
  readonly gateway: ClaudeGateway;
  readonly tokens: PactlabTokens;
  readonly emailSender: EmailSender | null;
  /** Keys the code and IP hashes: the same secret the sign-in codes use. */
  readonly hashSecret: string;
  /** Where invite links point: `<site>/rinse?invite=…` (T-178c builds the page). */
  readonly siteOrigin: string;
  /** Per account: AI jobs per 10 minutes, and per 24 hours. */
  readonly limits?: { perTenMinutes: number; perDay: number };
}
