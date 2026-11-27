import type { SupportChatReplyView } from '@pactlab/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({}));

import { HelpChat, HelpReply } from './help-chat';
import { HELP_LABELS, helpLocale } from './labels';

const reply = (over: Partial<SupportChatReplyView> = {}): SupportChatReplyView => ({
  kind: 'STEPS',
  text: 'Here is how sheet mapping works.',
  steps: ['Open Sources.', 'Select "Upload and map columns".'],
  citations: [{ title: 'Importing a spreadsheet', href: '/deals/d1/sources/upload' }, { title: 'Valuation', href: 'https://pactlab.ai/product/valuation/' }],
  deepLink: { label: 'Open the import page', href: '/deals/d1/sources/upload' },
  answeredIn: 'en',
  localeNote: null,
  offerEmail: false,
  featureRequest: null,
  ...over,
});

describe('the help chat panel (T-175)', () => {
  it('shows numbered steps, the deep link and every source, site pages opening in a new tab', () => {
    const html = renderToStaticMarkup(<HelpReply reply={reply()} labels={HELP_LABELS.en} />);
    expect(html).toContain('<ol');
    expect(html).toContain('Select &quot;Upload and map columns&quot;.');
    expect(html).toContain('href="/deals/d1/sources/upload"');
    expect(html).toContain('Open the import page');
    expect(html).toContain('href="https://pactlab.ai/product/valuation/" class="underline" target="_blank" rel="noopener noreferrer"');
  });

  it('says when it answers in English on a page in another language', () => {
    const html = renderToStaticMarkup(<HelpReply reply={reply({ localeNote: 'Les pages d’aide de Pactlab ne sont pas encore disponibles en français ; je réponds donc en anglais.' })} labels={HELP_LABELS.fr} />);
    expect(html).toContain('je réponds donc en anglais');
  });

  it('opens with its title, intro and the no-pact-data line, in the page’s language', () => {
    const html = renderToStaticMarkup(<HelpChat surface="SITE" locale="de" page="/" ask={vi.fn()} handOff={vi.fn()} />);
    expect(html).toContain('Fragen zu Pactlab');
    expect(html).toContain(HELP_LABELS.de.noPactData);
    expect(helpLocale('ja-JP')).toBe('ja');
    expect(helpLocale('es')).toBe('en');
  });

  it('has every panel label in every locale', () => {
    for (const locale of ['en', 'de', 'fr', 'ja'] as const) for (const [key, value] of Object.entries(HELP_LABELS[locale])) expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
  });
});
