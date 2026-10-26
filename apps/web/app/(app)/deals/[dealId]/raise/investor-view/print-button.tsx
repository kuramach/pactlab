'use client';

import { Button } from '@pactlab/ui';

/** Print or save as PDF: the shareable form of the investor view. */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      Print or save as PDF
    </Button>
  );
}
