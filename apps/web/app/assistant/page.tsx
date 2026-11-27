import type { Metadata } from 'next';
import { SiteHelpChat } from './site-help-chat';
import { helpLocale } from '../_components/help-chat/labels';

export const metadata: Metadata = { title: 'Ask about Pactlab', robots: { index: false, follow: false } };

/** Only a site path, such as `/how-it-works/`, is accepted as where the visitor came from. */
function sitePath(value: string | string[] | undefined): string {
  const path = typeof value === 'string' ? value : '/';
  return /^\/[A-Za-z0-9/_.-]{0,200}$/.test(path) && !path.startsWith('//') ? path : '/';
}

/**
 * The public site's help chat (T-175), opened from pactlab.ai in its own small window: anonymous, no sign-in,
 * nothing kept beyond the conversation on screen. `from` and `lang` are the site page and its language.
 */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const locale = helpLocale(typeof params['lang'] === 'string' ? params['lang'] : null);
  return (
    <main lang={locale} className="mx-auto flex h-dvh max-w-xl flex-col bg-background p-4">
      <SiteHelpChat locale={locale} page={sitePath(params['from'])} />
    </main>
  );
}
