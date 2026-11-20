'use client';

import { useEffect } from 'react';

/** Leaves the signing session's frame, so the pact opens in the whole window again. */
export function LeaveFrame({ href }: { href: string }) {
  useEffect(() => {
    (window.top ?? window).location.assign(href);
  }, [href]);
  return (
    <p className="text-sm">
      Returning to the pact… <a href={href} target="_top" className="font-semibold text-indigo-ink underline">Continue</a>
    </p>
  );
}
