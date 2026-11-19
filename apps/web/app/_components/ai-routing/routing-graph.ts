/**
 * The AI routing diagram (Kumar, 2026-11-19): how a pact's material flows through the AI jobs, and
 * which model serves each. Pure data (no React), so the layout and labels are tested on their own;
 * `routing-flow.tsx` only draws it. Used by Admin → AI models (platform defaults) and Settings → AI
 * models (one organization).
 */

export type JobType = 'deep_review' | 'contract_scrub' | 'extraction' | 'classification' | 'document_qa' | 'vision';
export type RoleAlias = 'fast' | 'balanced' | 'deep_review';
export type JobSource = 'ORGANIZATION' | 'PLATFORM' | 'DEPLOYMENT' | 'REGISTRY';

export interface RoutingLane {
  provider: string;
  modelId: string;
  label: string;
  available: boolean;
  reason: string | null;
}

export interface RoutingView {
  scope: 'PLATFORM' | 'ORGANIZATION';
  roles: { alias: RoleAlias; source: 'ORGANIZATION' | 'PLATFORM' | 'DEPLOYMENT'; lane: RoutingLane | null }[];
  jobs: { jobType: JobType; label: string; source: JobSource; lanes: RoutingLane[] }[];
}

export interface ModelChoice {
  id: string;
  provider: string;
  providerModelId: string;
  label: string;
}

/** What each job is called on the diagram, and what it does. */
export const JOB_TITLES: Record<JobType, { title: string; help: string }> = {
  classification: { title: 'Classification', help: 'what each file is, and where it goes' },
  vision: { title: 'Image documents', help: 'scans, charts and image tables read as text' },
  extraction: { title: 'Extraction', help: 'contract fields and financial lines' },
  contract_scrub: { title: 'Consistency checks', help: 'defined terms, cross-references, party names' },
  deep_review: { title: 'Deep review', help: 'judgment on agreement findings' },
  document_qa: { title: 'Questions and drafting', help: 'document Q&A, Foresight, briefs' },
};

export const ROLE_TITLES: Record<RoleAlias, string> = { fast: 'Claude · Fast', balanced: 'Claude · Balanced', deep_review: 'Claude · Deep review' };

const SOURCE_TEXT: Record<JobSource, string> = {
  ORGANIZATION: 'this organization’s choice',
  PLATFORM: 'platform default',
  DEPLOYMENT: 'set for this environment',
  REGISTRY: 'registry chain',
};

export function sourceText(source: JobSource, scope: RoutingView['scope']): string {
  // An organization sees the platform's choice as its default.
  if (scope === 'ORGANIZATION' && source === 'PLATFORM') return 'Pactlab default';
  return SOURCE_TEXT[source];
}

export type GraphNode =
  | { id: string; kind: 'input' | 'output'; title: string; note?: string; muted?: boolean; position: { x: number; y: number } }
  | { id: JobType; kind: 'job'; title: string; help: string; source: string; lanes: RoutingLane[]; position: { x: number; y: number } };

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  /** Not built yet (video): drawn dashed. */
  planned?: boolean;
}

/** Inputs on the left, the jobs in the middle, what people receive on the right. */
const POSITIONS: Record<string, { x: number; y: number }> = {
  upload: { x: 0, y: 60 },
  video: { x: 0, y: 300 },
  question: { x: 0, y: 470 },
  classification: { x: 250, y: 0 },
  vision: { x: 250, y: 220 },
  extraction: { x: 560, y: 60 },
  document_qa: { x: 560, y: 450 },
  contract_scrub: { x: 870, y: -60 },
  deep_review: { x: 870, y: 170 },
  findings: { x: 1180, y: 60 },
  review: { x: 1400, y: 60 },
  answer: { x: 870, y: 470 },
};

export function buildRoutingGraph(view: RoutingView): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byJob = new Map(view.jobs.map((job) => [job.jobType, job]));
  const job = (jobType: JobType): GraphNode => {
    const found = byJob.get(jobType);
    return { id: jobType, kind: 'job', ...JOB_TITLES[jobType], source: found ? sourceText(found.source, view.scope) : 'registry chain', lanes: found?.lanes ?? [], position: POSITIONS[jobType] as { x: number; y: number } };
  };
  const nodes: GraphNode[] = [
    { id: 'upload', kind: 'input', title: 'Uploaded documents', note: 'PDF, Word, spreadsheets, scans', position: POSITIONS['upload'] as { x: number; y: number } },
    { id: 'video', kind: 'input', title: 'Video', note: 'not yet: keyframes go to image documents', muted: true, position: POSITIONS['video'] as { x: number; y: number } },
    { id: 'question', kind: 'input', title: 'A question, Foresight or a brief', position: POSITIONS['question'] as { x: number; y: number } },
    job('classification'),
    job('vision'),
    job('extraction'),
    job('contract_scrub'),
    job('deep_review'),
    job('document_qa'),
    { id: 'findings', kind: 'output', title: 'Draft findings', note: 'every one cited to a page', position: POSITIONS['findings'] as { x: number; y: number } },
    { id: 'review', kind: 'output', title: 'A person reviews', note: 'accepts or rejects; AI never decides', position: POSITIONS['review'] as { x: number; y: number } },
    { id: 'answer', kind: 'output', title: 'Cited answer', position: POSITIONS['answer'] as { x: number; y: number } },
  ];
  const edges: GraphEdge[] = [
    { id: 'upload-classification', source: 'upload', target: 'classification', label: 'text pages' },
    { id: 'upload-vision', source: 'upload', target: 'vision', label: 'images and scans' },
    { id: 'video-vision', source: 'video', target: 'vision', label: 'keyframes', planned: true },
    { id: 'classification-extraction', source: 'classification', target: 'extraction', label: 'filed documents' },
    { id: 'vision-extraction', source: 'vision', target: 'extraction', label: 'text from images' },
    { id: 'extraction-contract_scrub', source: 'extraction', target: 'contract_scrub', label: 'agreements' },
    { id: 'extraction-deep_review', source: 'extraction', target: 'deep_review', label: 'clauses' },
    { id: 'extraction-findings', source: 'extraction', target: 'findings', label: 'fields' },
    { id: 'contract_scrub-findings', source: 'contract_scrub', target: 'findings', label: 'drafting problems' },
    { id: 'deep_review-findings', source: 'deep_review', target: 'findings', label: 'judgments' },
    { id: 'findings-review', source: 'findings', target: 'review', label: 'review queue' },
    { id: 'question-document_qa', source: 'question', target: 'document_qa', label: 'question' },
    { id: 'classification-document_qa', source: 'classification', target: 'document_qa', label: 'document pages' },
    { id: 'document_qa-answer', source: 'document_qa', target: 'answer', label: 'answer with citations' },
  ];
  return { nodes, edges };
}
