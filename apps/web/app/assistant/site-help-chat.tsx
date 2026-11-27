'use client';

import type { SupportChatLocale } from '@pactlab/contracts';
import { askHelpOnSite, handOffHelpOnSite } from '../_components/help-chat/actions';
import { HelpChat } from '../_components/help-chat/help-chat';

export function SiteHelpChat({ locale, page }: { locale: SupportChatLocale; page: string }) {
  return <HelpChat surface="SITE" locale={locale} page={page} ask={askHelpOnSite} handOff={handOffHelpOnSite} onClose={() => window.close()} />;
}
