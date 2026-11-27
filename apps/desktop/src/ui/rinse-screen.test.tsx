import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinesConverter } from '../engine/converter';
import { docx } from '../engine/fixture-set';
import { RinseSet } from '../engine/rinse-set';
import { FlaskMark } from './flask-mark';
import { RINSE_TAGLINE, RinseScreen } from './rinse-screen';

const PREPARER = { userId: '0193a1b2-0000-7000-8000-00000000a001', name: 'Dana Whitlow', organization: 'Harbour Lane Apartments LLC (synthetic)' };

describe('the Rinse screens (T-178)', () => {
  it('the flask moves while working, stills when clean, and honours reduced motion', () => {
    const working = renderToStaticMarkup(<FlaskMark state="working" />);
    expect(working).toContain('rinse-vapour');
    expect(working).toContain('prefers-reduced-motion: reduce');
    expect(working).toContain('aria-label="Rinsing your documents"');
    const clean = renderToStaticMarkup(<FlaskMark state="clean" />);
    expect(clean).not.toContain('rinse-vapour');
    expect(clean).not.toContain('@keyframes');
  });

  it('shows the checklist with both ways to close a gap, the mismatch side by side, and no upload until ready', async () => {
    const set = new RinseSet({ name: 'Harbour Lane (synthetic)', companyType: 'MULTIFAMILY', currency: 'USD', preparer: PREPARER, converter: new LinesConverter() });
    set.add('Income statement.docx', docx(['Rental income: USD 1,642,000', 'Other income: USD 58,000', 'Total revenue: USD 1,700,000']));
    await set.rinse({ online: false });
    const html = renderToStaticMarkup(<RinseScreen name="Harbour Lane (synthetic)" view={set.view()} running={false} />);
    expect(html).toContain('Pactlab Rinse');
    expect(html).toContain(RINSE_TAGLINE);
    expect(html).toContain('Add the file');
    expect(html).toContain('Enter by hand');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Upload the finished set<\/button>/);
    expect(html).toContain('wait until you are online and signed in');
  });
});
