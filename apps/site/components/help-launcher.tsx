'use client';

/**
 * "Ask about Pactlab" (T-175): opens the help chat in a small window served by the app, where it answers from
 * these pages. The site itself stays static and calls nothing; the chat keeps nothing beyond the conversation.
 */
export function HelpLauncher({ assistantUrl }: { assistantUrl: string }) {
  const open = () => {
    const url = new URL(assistantUrl);
    url.searchParams.set('from', window.location.pathname);
    url.searchParams.set('lang', document.documentElement.lang || 'en');
    const opened = window.open(url.toString(), 'pactlab-help', 'popup,width=440,height=680');
    // A blocked popup: open it as a normal tab instead.
    if (!opened) window.location.assign(url.toString());
  };
  return (
    <button
      type="button"
      onClick={open}
      className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-navy px-4 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-white/20 hover:bg-navy/90 focus:outline-none focus:ring-2 focus:ring-indigo"
    >
      <span aria-hidden className="font-extrabold">
        ?
      </span>
      Ask about Pactlab
    </button>
  );
}
