'use client';

import { ChatMark } from '@pactlab/ui';
import { usePathname } from 'next/navigation';
import type { SupportChatLocale } from '@pactlab/contracts';
import { useEffect, useState } from 'react';
import { askHelpInApp, handOffHelpInApp } from '../../_components/help-chat/actions';
import { HelpChat } from '../../_components/help-chat/help-chat';
import { HELP_LABELS, helpLocale } from '../../_components/help-chat/labels';

/**
 * The in-app help chat (T-175): a button left of What's new, the speaking flask, opening the shared panel. It sends only the
 * page the person is on and their question; the answer comes from Pactlab's guides, never from a pact.
 */
export function HelpChatLauncher() {
  const page = usePathname() || '/';
  const [open, setOpen] = useState(false);
  // The app's language (T-172 sets <html lang>); read after hydration so server and client render alike.
  const [locale, setLocale] = useState<SupportChatLocale>('en');
  useEffect(() => setLocale(helpLocale(document.documentElement.lang)), []);
  const labels = HELP_LABELS[locale];
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="help-chat-panel"
        aria-label={labels.title}
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 right-[8.5rem] z-30 flex h-11 w-11 items-center justify-center rounded-full bg-white text-navy shadow-lg ring-1 ring-navy/20 hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-indigo"
      >
        {/* On the right of the page, so the left-facing artwork looks into it (T-186). */}
        <ChatMark placement="right" className="h-8 w-8" />
      </button>
      {open ? (
        <div id="help-chat-panel" className="fixed bottom-20 right-4 z-40 flex h-[min(36rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-xl bg-card p-4 shadow-xl ring-1 ring-border">
          <HelpChat surface="APP" locale={locale} page={page} ask={askHelpInApp} handOff={handOffHelpInApp} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
