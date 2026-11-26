import { signingOutcomes } from '@pactlab/db';
import type { JobDependencies } from './noop';

export const SIGNING_POLL_SWEEP_JOB_TYPE = 'signing.poll-sweep';
/** Repeat every 15 minutes. */
export const SIGNING_POLL_SWEEP_EVERY_MS = 15 * 60_000;
/** Envelopes read per page, and pages per run: a bounded batch, the rest wait for the next sweep. */
export const SIGNING_POLL_PAGE_SIZE = 50;
export const SIGNING_POLL_MAX_PAGES = 10;

export interface SweepOutcome {
  polled: number;
  changed: number;
  failed: number;
  skipped: number;
}

/**
 * The polling fallback for a missed webhook (T-144): polls each open envelope through the signing
 * seam, with no page open. It records through `signingOutcomes.observe`, the same idempotent
 * recorder the webhook and the page-load poll use (`poll:<status>` names the observation), so a
 * webhook and a poll for one event apply once. An envelope that cannot be polled is stamped as
 * checked and audited on its pact (`signing.poll_failed`). Replay-safe: a rerun finds nothing new.
 * Envelopes whose provider is not configured here (an organization's DocuSign, which needs the
 * organization's own token) are left to the page-load poll.
 */
export async function processSigningPollSweep(deps: JobDependencies, now: () => number = Date.now, intervalMs = SIGNING_POLL_SWEEP_EVERY_MS): Promise<SweepOutcome> {
  const outcome: SweepOutcome = { polled: 0, changed: 0, failed: 0, skipped: 0 };
  // Anything checked within the interval (by this sweep or a page load) is fresh enough.
  const staleBefore = new Date(now() - intervalMs / 2);
  let after: string | null = null;
  for (let page = 0; page < SIGNING_POLL_MAX_PAGES; page += 1) {
    const envelopes = await signingOutcomes.openPage(deps.prisma, { staleBefore, after, limit: SIGNING_POLL_PAGE_SIZE });
    for (const envelope of envelopes) {
      const provider = deps.signingProviders?.[envelope.provider];
      if (!provider) {
        outcome.skipped += 1;
        continue;
      }
      try {
        const state = await provider.status(envelope.providerEnvelopeId);
        outcome.polled += 1;
        const changed = await signingOutcomes.observe(deps.prisma, { provider: envelope.provider, envelopeId: envelope.providerEnvelopeId, status: state.status, reason: state.reason, eventId: `poll:${state.status}`, source: 'POLL' });
        if (changed) outcome.changed += 1;
      } catch {
        // handled: stamped as checked and audited as signing.poll_failed on the pact, where its team sees it.
        await signingOutcomes.pollFailed(deps.prisma, envelope.envelopeRowId);
        outcome.failed += 1;
      }
    }
    if (envelopes.length < SIGNING_POLL_PAGE_SIZE) break;
    after = envelopes[envelopes.length - 1]?.envelopeRowId ?? null;
  }
  return outcome;
}
