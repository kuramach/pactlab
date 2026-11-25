import { describe, expect, it } from 'vitest';
import { buildRoutingGraph, sourceText, type RoutingView } from './routing-graph';

const claude = { provider: 'anthropic', modelId: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', available: true, reason: null };
const view = (scope: RoutingView['scope']): RoutingView => ({
  scope,
  roles: [{ alias: 'balanced', source: 'PLATFORM', lane: claude }],
  jobs: [
    { jobType: 'extraction', label: 'Extraction', source: 'ORGANIZATION', lanes: [{ provider: 'google', modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', available: false, reason: 'Google not connected' }, claude] },
    { jobType: 'classification', label: 'Classification', source: 'PLATFORM', lanes: [claude] },
    { jobType: 'vision', label: 'Vision', source: 'REGISTRY', lanes: [claude] },
    { jobType: 'contract_scrub', label: 'Scrub', source: 'REGISTRY', lanes: [claude] },
    { jobType: 'deep_review', label: 'Deep', source: 'REGISTRY', lanes: [claude] },
    { jobType: 'document_qa', label: 'QA', source: 'DEPLOYMENT', lanes: [claude] },
  ],
});

describe('AI routing diagram', () => {
  it('has a node for every job, between the inputs and what people receive', () => {
    const { nodes } = buildRoutingGraph(view('PLATFORM'));
    expect(nodes.filter((n) => n.kind === 'job').map((n) => n.id).sort()).toEqual(['classification', 'contract_scrub', 'deep_review', 'document_qa', 'extraction', 'import_mapping', 'vision']);
    expect(nodes.filter((n) => n.kind === 'input').map((n) => n.id)).toEqual(['spreadsheet', 'upload', 'video', 'question']);
    expect(nodes.filter((n) => n.kind === 'output').map((n) => n.id)).toEqual(['imported', 'findings', 'review', 'answer']);
    const x = (id: string) => nodes.find((n) => n.id === id)?.position.x ?? -1;
    // Spreadsheets for import: their own job, then a mapping a person confirms (Kumar, 2026-11-25).
    expect(x('spreadsheet')).toBeLessThan(x('import_mapping'));
    expect(x('import_mapping')).toBeLessThan(x('imported'));
    expect(x('upload')).toBeLessThan(x('classification'));
    expect(x('extraction')).toBeLessThan(x('findings'));
    expect(x('findings')).toBeLessThan(x('review'));
  });

  it('labels each arrow by what flows along it; video is drawn as not yet built', () => {
    const { edges, nodes } = buildRoutingGraph(view('PLATFORM'));
    expect(edges.find((e) => e.id === 'upload-classification')?.label).toBe('text pages');
    expect(edges.find((e) => e.id === 'upload-vision')?.label).toBe('images and scans');
    expect(edges.filter((e) => e.planned).map((e) => e.id)).toEqual(['video-vision']);
    expect(nodes.find((n) => n.id === 'video')).toMatchObject({ muted: true });
    const ids = new Set(nodes.map((n) => n.id));
    for (const edge of edges) expect(ids.has(edge.source) && ids.has(edge.target), edge.id).toBe(true);
  });

  it('shows where each choice comes from, and keeps greyed lanes with their reason', () => {
    const jobs = buildRoutingGraph(view('ORGANIZATION')).nodes.filter((n) => n.kind === 'job');
    const extraction = jobs.find((n) => n.id === 'extraction');
    expect(extraction).toMatchObject({ source: 'this organization’s choice', lanes: [{ available: false, reason: 'Google not connected' }, { available: true }] });
    expect(jobs.find((n) => n.id === 'classification')).toMatchObject({ source: 'Pactlab default' });
    expect(sourceText('PLATFORM', 'PLATFORM')).toBe('platform default');
    expect(sourceText('REGISTRY', 'ORGANIZATION')).toBe('registry chain');
  });
});
