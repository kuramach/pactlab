import type { ClaimView } from '@pactlab/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN, i18nFor } from '../../../../lib/i18n';
import { directionText, formatPricedRisk } from '../../findings/_lib/view';
import { pagerLinks } from '../../../_components/pager';
import { PipelineCard, pipelineSteps } from './pipeline';
import { SellerClaims } from './seller-claims';
import { ApiState } from './states';

/** The pilot surface's shared pieces render in German when the reader chose German (T-172), and in English otherwise. */
const de = i18nFor('de');
const counts = { documents: 1, drafts: 3, accepted: 0, scenarios: 2, staleScenarios: 1 };

describe('the German pilot', () => {
  it('writes the pipeline in German, with German plurals', () => {
    const html = renderToStaticMarkup(<PipelineCard steps={pipelineSteps('d', counts, de)} t={de} />);
    expect(html).toContain('Dokumente eingegangen');
    expect(html).toContain('1 Dokument; die KI-Extraktion beginnt beim Hochladen');
    expect(html).toContain('3 KI-Entwürfe warten auf eine Person');
    expect(html).toContain('1 Szenario muss nach neuen Befunden erneut berechnet werden');
    expect(html).not.toContain('Documents in');
  });

  it('keeps English unchanged for English readers', () => {
    const steps = pipelineSteps('d', counts);
    expect(steps.map((step) => step.detail)).toEqual(['1 document; AI extraction starts on upload', '3 AI drafts waiting for a person', '0 accepted', '1 scenario needs a re-run after new findings']);
    expect(renderToStaticMarkup(<ApiState result={{ kind: 'forbidden' }} />)).toContain('No access');
  });

  it('writes states, claims, directions, pager and priced risk in German, money in the pact’s currency', () => {
    expect(renderToStaticMarkup(<ApiState result={{ kind: 'error', requestId: 'r-1' }} t={de} />)).toContain('Referenz r-1.');
    const claim = { id: 'c', statement: 'ARR is 12m', source: null, status: 'CONTRADICTED', origin: 'MANUAL', rationale: null, findings: [] } as unknown as ClaimView;
    expect(renderToStaticMarkup(<SellerClaims claims={[claim]} t={de} />)).toContain('Durch die Nachweise widerlegt');
    expect(directionText(-1, de)).toBe('Belastung');
    expect(directionText(-1, EN)).toBe('drag');
    expect(formatPricedRisk({ type: 'ESCROW', currency: 'JPY', low: '1000000', high: '2500000', basis: 'x' }, de)).toBe('1.000.000 – 2.500.000 JPY');
    expect(pagerLinks({ nextCursor: null, total: 1342, limit: 50, itemCount: 50 }, { cursor: undefined, trail: [] }, {}, '', de).windowLabel).toBe('1–50 von 1.342');
  });
});
