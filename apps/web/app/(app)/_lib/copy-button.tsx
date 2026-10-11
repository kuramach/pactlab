'use client';

import { Button } from '@pactlab/ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Copies text to the clipboard in the browser. Nothing is sent anywhere. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
