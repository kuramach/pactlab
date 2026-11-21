import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./ai-model-actions', () => ({ evaluateModel: vi.fn(), retireModel: vi.fn(), setOrganizationModels: vi.fn(), setPlatformRoute: vi.fn(), setProviderTerms: vi.fn(), useBedrockModel: vi.fn() }));
vi.mock('../(app)/deals/_lib/api', () => ({ apiGet: vi.fn() }));

const { ModelsInUse } = await import('./ai-models');
const model = (over: Record<string, unknown>) => ({ id: 'm1', provider: 'bedrock', providerModelId: 'us.anthropic.claude-haiku-5-5', label: 'Claude Haiku 5.5', status: 'EVALUATED', evaluation: { kind: 'health', passed: true }, evaluatingSince: null, reevaluationDue: false, organizations: 0, platformAliases: [], ...over }) as never;

describe('Models in use (2026-11-21): name, maker, ready or not, where used; no scores', () => {
  it('a ready model in use says where, and cannot be removed', () => {
    const html = renderToStaticMarkup(<ModelsInUse models={[model({ platformAliases: ['fast'] })]} />);
    expect(html).toContain('Claude Haiku 5.5');
    expect(html).toContain('Anthropic');
    expect(html).toContain('Default for Fast');
    expect(html).not.toContain('Remove');
    expect(html).not.toMatch(/golden|probes|precision/);
  });

  it('a model that failed its check says why, offers Check again, and an unused one can be removed', () => {
    const html = renderToStaticMarkup(<ModelsInUse models={[model({ status: 'ADDED', evaluation: { kind: 'health', passed: false, failures: ['The model could not be called (access).'] } })]} />);
    expect(html).toContain('Not working: The model could not be called (access).');
    expect(html).toContain('Check again');
    expect(html).toContain('Remove');
  });
});
