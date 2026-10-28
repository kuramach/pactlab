import { describe, expect, it } from 'vitest';
import { pipelineSteps } from './pipeline';
import { DEAL_GROUPS, dealGroup, dealSection } from './deal-tabs';

const id = '01900000-0000-7000-8000-00000000c003';

describe('dealSection', () => {
  it('finds the section for deal pages and their sub-pages', () => {
    expect(dealSection(id, `/deals/${id}`)).toBe('');
    expect(dealSection(id, `/deals/${id}/sources/upload/x`)).toBe('/sources');
    expect(dealSection(id, `/deals/${id}/evidence/abc`)).toBe('/evidence');
    expect(dealSection(id, `/deals/${id}/finances`)).toBe('/finances');
    expect(dealSection(id, `/deals/${id}/sourcesx`)).toBe('');
  });
});

describe('deal tabs (T-094 B13)', () => {
  it('has four tabs, and every former tab still has a home', () => {
    expect(DEAL_GROUPS.map((group) => group.label)).toEqual(['Overview', 'Diligence', 'Valuation', 'Close']);
    const paths = DEAL_GROUPS.flatMap((group) => group.sections.map((section) => section.path));
    for (const former of ['', '/screening', '/raise', '/sources', '/evidence', '/finances', '/findings', '/claims', '/engineering', '/valuation', '/foresight', '/documents', '/post-close', '/team']) {
      expect(paths, former).toContain(former);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('puts each page under its tab', () => {
    expect(dealGroup(dealSection(id, `/deals/${id}/documents`)).key).toBe('diligence');
    expect(dealGroup(dealSection(id, `/deals/${id}/findings/abc`)).key).toBe('diligence');
    expect(dealGroup(dealSection(id, `/deals/${id}/foresight`)).key).toBe('valuation');
    expect(dealGroup(dealSection(id, `/deals/${id}/post-close`)).key).toBe('close');
    expect(dealGroup(dealSection(id, `/deals/${id}`)).key).toBe('overview');
  });
});

describe('pipeline (T-094 B13)', () => {
  it('reads live state: waiting drafts and stale scenarios need a person', () => {
    const steps = pipelineSteps(id, { documents: 3, drafts: 5, accepted: 2, scenarios: 1, staleScenarios: 1 });
    expect(steps.map((step) => step.state)).toEqual(['done', 'waiting', 'done', 'waiting']);
    expect(steps[1]?.detail).toBe('5 AI drafts waiting for a person');
    expect(pipelineSteps(id, { documents: 0, drafts: 0, accepted: 0, scenarios: 0, staleScenarios: 0 }).map((step) => step.state)).toEqual(['next', 'next', 'next', 'next']);
  });
});
