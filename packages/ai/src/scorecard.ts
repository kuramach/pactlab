/**
 * The model scorecard as data (docs/model-scorecard.md, Nov 21, 2026; refresh monthly with the doc). Public
 * benchmark scores are priors per job, never verdicts: a pick serves only if Pactlab can reach it, its data
 * terms are recorded (DPA and zero retention for providers outside AWS) and its health check passes. Scores
 * are in each board's own metric and are not comparable across boards. Nothing here is a model ID: picks are
 * matched by name against what Bedrock actually lists for the account.
 */
export const SCORECARD_AS_OF = '2026-11-21';
export const SCORECARD_SOURCE = 'docs/model-scorecard.md';

export type ScorecardJob = 'deep_review' | 'contract_scrub' | 'extraction' | 'classification' | 'document_qa' | 'vision' | 'fast';

export interface ScorecardPick {
  /** The model's name as the boards give it (e.g. "Claude Opus 5.5"). */
  readonly name: string;
  /** The board's figure, in that board's own metric, or null when the board has none. */
  readonly score: string | null;
  /** Cost per finished task, or null when no public figure exists. */
  readonly costPerTask: string | null;
  /** Primary or fallback in the scorecard's routing read. */
  readonly role: 'primary' | 'fallback' | 'evaluate';
  readonly note?: string;
}

export interface ScorecardEntry {
  readonly job: ScorecardJob;
  readonly label: string;
  /** The board that measures this job, and when. */
  readonly board: string;
  readonly verdict: string;
  readonly picks: readonly ScorecardPick[];
}

export const SCORECARD: readonly ScorecardEntry[] = [
  {
    job: 'deep_review',
    label: 'Deep review',
    board: 'legalbenchmarks.ai single-pass boards, Nov 2026 (drafting task pass)',
    verdict: 'Supported: Opus 5.5 leads every single-pass legal board.',
    picks: [
      { name: 'Claude Opus 5.5', score: '48.4% drafting · 76.7% extraction', costPerTask: '$1.47', role: 'primary' },
      { name: 'GPT-6.2 Astra', score: '15.0% Harvey LAB-AA (best bare model)', costPerTask: null, role: 'fallback' },
    ],
  },
  {
    job: 'contract_scrub',
    label: 'Consistency checks',
    board: 'ContractScrub, Aug 2026 (planted errors caught)',
    verdict: 'Supported by the only direct study; successors unmeasured.',
    picks: [
      { name: 'GPT-5.5', score: '75%', costPerTask: null, role: 'primary' },
      { name: 'Gemini 3.1 Pro', score: '74%', costPerTask: null, role: 'fallback' },
    ],
  },
  {
    job: 'extraction',
    label: 'Extraction',
    board: 'legalbenchmarks.ai Data Extraction, Nov 2026 (task pass)',
    verdict: 'Split: schema fields on cost (Haiku 5.5), Opus 5.5 for quality; Gemini 3.1 Pro the volume lane.',
    picks: [
      { name: 'Claude Haiku 5.5', score: '56.7%', costPerTask: '$0.20', role: 'primary', note: 'fastest on the board (1m 41s)' },
      { name: 'Claude Opus 5.5', score: '76.7%', costPerTask: '$2.71', role: 'fallback', note: 'best score; too costly per document at volume' },
      { name: 'Gemini 3.1 Pro', score: '82% field accuracy (May 2026)', costPerTask: '$0.19 per contract', role: 'fallback' },
    ],
  },
  {
    job: 'classification',
    label: 'Classification',
    board: 'No current board scores frontier models on CUAD/MAUD',
    verdict: 'No public evidence either way: route on cost and latency.',
    picks: [
      { name: 'Gemini 3.1 Pro', score: '87.40% LegalBench (saturated)', costPerTask: null, role: 'primary' },
      { name: 'Claude Haiku 5.5', score: null, costPerTask: '$0.20', role: 'fallback', note: 'Flash/Haiku tier is the expected end state' },
    ],
  },
  {
    job: 'document_qa',
    label: 'Questions and drafting',
    board: 'MKA (Google DeepMind; Climb-WSR via Artificial Analysis, Nov 21, 2026)',
    verdict: 'Right family, stale generation: evaluate Gemini 4 Argon and Gemini 4 Neon; Opus 5.5 fallback.',
    picks: [
      { name: 'Gemini 4 Argon', score: '27.1% HLAB-Vals (file work)', costPerTask: '$10.55 per test', role: 'evaluate' },
      { name: 'Gemini 4 Neon', score: '56.5% MKA Climb-WSR (Xhigh)', costPerTask: null, role: 'evaluate', note: 'new Nov 2026; Xhigh variant; access unverified' },
      { name: 'Claude Opus 5.5', score: null, costPerTask: null, role: 'fallback', note: 'single-pass Q&A over retrieved context' },
      { name: 'Gemini 3.1 Pro', score: null, costPerTask: null, role: 'primary', note: 'current route; unscored on November boards' },
    ],
  },
  {
    job: 'vision',
    label: 'Image documents',
    board: 'BenchLM multimodal & grounded, Nov 21, 2026',
    verdict: 'Unscored current route: evaluate GPT-6.2 Astra, Fable 5.2 and Gemini 4 Carbon; keep Gemini 3.1 Pro until one passes.',
    picks: [
      { name: 'GPT-6.2 Astra', score: '90.3', costPerTask: null, role: 'evaluate', note: '#1 of 119; Estimated label (thin evidence)' },
      { name: 'Claude Fable 5.2', score: '87.1', costPerTask: null, role: 'evaluate', note: '#2 of 119' },
      { name: 'Gemini 4 Carbon', score: '85.8', costPerTask: null, role: 'evaluate', note: 'access limited' },
      { name: 'Claude Opus 5.5', score: '80.6', costPerTask: null, role: 'fallback' },
      { name: 'Gemini 3.1 Pro', score: null, costPerTask: null, role: 'primary', note: 'current route; unscored' },
    ],
  },
  {
    job: 'fast',
    label: 'Fast triage',
    board: 'Cost and latency columns of the legal boards, Nov 2026',
    verdict: 'Confirmed: Haiku 5.5 primary; route on cost and speed only.',
    picks: [
      { name: 'Claude Haiku 5.5', score: '56.7% extraction floor', costPerTask: '$0.20', role: 'primary', note: 'fastest measured latency' },
      { name: 'Gemini 3.5 Flash', score: '65.5% (July reliability)', costPerTask: '~$0.08', role: 'fallback' },
    ],
  },
];

/** A name or id as comparable tokens: "Claude Opus 5.5" and "us.anthropic.claude-opus-5-5" both give "opus 5 5". */
const tokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/^(?:us|eu|apac|global|us-gov)\./, '')
    .replace(/^[a-z0-9-]+\./, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(claude|anthropic|google|openai|meta|v\d+)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Whether a Bedrock model (by id or name) is exactly this scorecard pick, allowing only version or date suffixes. */
export function matchesPick(pick: Pick<ScorecardPick, 'name'>, model: { modelId: string; name: string }): boolean {
  const want = tokens(pick.name);
  if (!want) return false;
  // The same model, never a variant ("GPT-5.5 mini" is not "GPT-5.5"): only version or date digits may follow.
  return [tokens(model.modelId), tokens(model.name)].some((have) => have === want || (have.startsWith(`${want} `) && /^[\d ]+$/.test(have.slice(want.length + 1))));
}
