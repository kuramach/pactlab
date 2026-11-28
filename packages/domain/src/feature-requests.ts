/**
 * Feature requests from the help chat (T-176). A request is product feedback only: the requester's own words,
 * confirmed in chat (T-175 keeps pact data out before it gets here). Similarity only SUGGESTS that two requests
 * are the same ask; a person confirms it. Nothing here approves anything.
 */
export const FEATURE_REQUEST_STATUSES = ['SUBMITTED', 'IN_TRIAGE', 'INFO_REQUESTED', 'APPROVED', 'DECLINED', 'SHIPPED'] as const;
export type FeatureRequestStatus = (typeof FEATURE_REQUEST_STATUSES)[number];
export const FEATURE_REQUEST_SURFACES = ['SITE', 'APP'] as const;
export type FeatureRequestSurface = (typeof FEATURE_REQUEST_SURFACES)[number];

/** The reference shown to the team and in emails: FR-0007. */
export const featureRequestReference = (number: number) => `FR-${String(number).padStart(4, '0')}`;

/**
 * What the requester is told. Honest by design: "approved" means a task exists, never a date.
 */
export const REQUESTER_STATUS: Record<FeatureRequestStatus, { label: string; text: string }> = {
  SUBMITTED: { label: 'Submitted', text: 'The team has your request and has not looked at it yet.' },
  IN_TRIAGE: { label: 'In triage', text: 'The team is reading it and deciding.' },
  INFO_REQUESTED: { label: 'We asked you a question', text: 'The team needs a little more from you before deciding.' },
  APPROVED: { label: 'Approved', text: 'A task now exists for it. That is not a date: nothing has been promised about when, or whether, it ships.' },
  DECLINED: { label: 'Declined', text: 'The team decided not to build this.' },
  SHIPPED: { label: 'Shipped', text: 'It is built and live.' },
};

const STOP = new Set(
  'a an and are as at be but by can could do for from get has have i in is it its just like make me my of on or our please so that the their them there this to up us want we when with would you your add allow able need needs support have also more new feature features pactlab app'.split(' '),
);

/** Lower-case words with a light plural/gerund strip, so "exports" and "export" meet. */
export function featureTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !STOP.has(word))
    .map((word) => (word.length > 4 ? word.replace(/(ing|ed|es|s)$/, '') : word));
}

/** Jaccard overlap of the two requests' words, 0 to 1. */
export function featureSimilarity(a: string, b: string): number {
  const left = new Set(featureTokens(a));
  const right = new Set(featureTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** At or above this, a request is suggested as the same ask as an existing proposal. A person still confirms. */
export const SIMILARITY_THRESHOLD = 0.5;

export interface FeatureCandidate {
  id: string;
  title: string;
  description: string;
}

/** The existing proposal a new request most resembles, if any resembles it enough. */
export function bestFeatureMatch(request: { title: string; description: string }, candidates: readonly FeatureCandidate[], threshold = SIMILARITY_THRESHOLD): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = Math.max(
      featureSimilarity(`${request.title} ${request.description}`, `${candidate.title} ${candidate.description}`),
      featureSimilarity(request.title, candidate.title),
    );
    if (score >= threshold && (!best || score > best.score)) best = { id: candidate.id, score };
  }
  return best;
}

export type FeatureSpamReason = 'LINKS' | 'REPEATED' | 'SHOUTING' | 'TOO_SHORT';

/** The spam screen on the public intake. Cheap and deterministic; it declines, it never files quietly. */
export function screenFeatureRequest(request: { title: string; description: string }): { ok: true } | { ok: false; reason: FeatureSpamReason } {
  const text = `${request.title}\n${request.description}`;
  if ((text.match(/https?:\/\/|www\./gi) ?? []).length > 1) return { ok: false, reason: 'LINKS' };
  if (/(.)\1{9,}/u.test(text) || /\b(\p{L}{2,})\b(?:\W+\1\b){4,}/iu.test(text)) return { ok: false, reason: 'REPEATED' };
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 30 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return { ok: false, reason: 'SHOUTING' };
  if (featureTokens(text).length < 2) return { ok: false, reason: 'TOO_SHORT' };
  return { ok: true };
}

export const TASK_ENGINES = ['claude'] as const;
export const TASK_MODELS = ['sonnet', 'opus'] as const;
export const TASK_CONTEXTS = ['light', 'standard', 'deep'] as const;

export interface ProposedTask {
  engine: 'claude';
  model: (typeof TASK_MODELS)[number];
  lane: string;
  context: (typeof TASK_CONTEXTS)[number];
  touches: string[];
  needs: string;
}

/**
 * Where a request probably lands, from the surface it was made on and the page it was made from. A first guess for
 * Kumar to edit before the task file is written.
 */
export function proposeTask(request: { surface: FeatureRequestSurface; page: string }): ProposedTask {
  if (request.surface === 'SITE') return { engine: 'claude', model: 'sonnet', lane: 'web', context: 'standard', touches: ['apps/site', 'docs', 'tasks'], needs: 'none' };
  const touches = ['apps/web', 'apps/api', 'packages/contracts', 'docs', 'tasks'];
  return { engine: 'claude', model: 'opus', lane: 'platform', context: 'standard', touches, needs: 'none' };
}

const TOUCH = /^[A-Za-z0-9_./*-]{1,80}$/;
/** A `Touches:` path is a repo path, nothing that could carry a second header line. */
export const isTouchPath = (value: string) => TOUCH.test(value) && !value.includes('..') && !value.startsWith('/');
