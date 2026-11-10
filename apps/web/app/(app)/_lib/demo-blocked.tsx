'use client';

import { useSearchParams } from 'next/navigation';

/** After an outward action in a shared demo (T-113) the app comes back here with `?demo=blocked`. */
export function DemoBlockedNotice() {
  const params = useSearchParams();
  if (params.get('demo') !== 'blocked') return null;
  return (
    <p role="alert" className="mt-1 font-semibold">
      That action reaches outside Pactlab, so it is not available in a shared demo.
    </p>
  );
}
