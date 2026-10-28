'use client';

import { Button } from '@pactlab/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteDeal } from './delete-actions';

/**
 * Delete a deal (deal lead only). It is one-way: everyone loses access, and
 * stored files are removed except those on legal hold. The lead types the
 * deal's name to confirm.
 */
export function DeleteDealButton({ dealId, dealName }: { dealId: string; dealName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={`Delete ${dealName}`} className="inline-flex text-muted-foreground hover:text-red-700">
        <Trash2 aria-hidden className="h-4 w-4" />
      </button>
    );
  }
  return (
    <div role="dialog" aria-label={`Delete ${dealName}`} className="flex flex-col items-end gap-2 text-left text-xs">
      <p className="max-w-xs">
        Delete <span className="font-semibold">{dealName}</span> for everyone on it? Uploaded files are removed (legal-hold files are kept); the audit trail is kept. This cannot be undone.
      </p>
      <input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder="Type the deal name"
        aria-label="Type the deal name to confirm"
        className="w-56 rounded-md border border-border bg-background px-2 py-1"
      />
      <span className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setTyped(''); setError(null); }}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || typed.trim() !== dealName.trim()}
          className="bg-red-700 text-white hover:bg-red-800"
          onClick={() => {
            setBusy(true);
            void deleteDeal(dealId, typed).then((result) => {
              setBusy(false);
              if (result.kind === 'error') setError(result.message);
              else router.refresh();
            });
          }}
        >
          {busy ? 'Deleting…' : 'Delete deal'}
        </Button>
      </span>
      {error ? <span className="text-red-700">{error}</span> : null}
    </div>
  );
}
