'use client';

import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { connectSource, syncSource, type SourceSyncFile } from './actions';
import { sortDocument } from './sorting';

export interface DocumentSourceView {
  readonly id: string;
  readonly provider: string;
  readonly providerLabel: string;
  readonly mode: 'FIXTURE' | 'LIVE';
  readonly displayName: string;
  readonly folder: string | null;
  readonly status: string;
  readonly lastSyncedAt: string | null;
  readonly lastSyncSummary: Readonly<Record<string, number>> | null;
}

export interface SourcesView {
  readonly items: readonly DocumentSourceView[];
  readonly fixtureRooms: readonly { readonly id: string; readonly label: string }[];
}

const OUTCOME: Record<SourceSyncFile['outcome'], string> = {
  NEW: 'New',
  UPDATED: 'New version',
  UNCHANGED: 'Unchanged',
  DUPLICATE: 'Already here',
  REMOVED: 'Removed at the source',
  SKIPPED: 'Not a file Pactlab reads',
  REJECTED: 'Refused',
};

const PROVIDERS = [
  { id: 'google-drive', label: 'Google Drive', folderHint: 'Folder id (from the folder URL)' },
  { id: 'onedrive', label: 'OneDrive / SharePoint', folderHint: '<drive-id>/<folder-item-id>' },
] as const;

interface Row {
  readonly path: string;
  readonly outcome: SourceSyncFile['outcome'];
  message?: string;
  sorting?: boolean;
}

/**
 * Connected data rooms and drives (T-098). Pactlab reads them; it never
 * writes, moves or shares files at the source. "Sync now" reads new and
 * changed files, then the AI sorts each one as it does uploads.
 */
export function SourcesPanel({ dealId, sources, aiOn }: { dealId: string; sources: SourcesView; aiOn: boolean }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(sources.items.length === 0);

  const sync = async (sourceId: string) => {
    setSyncing(sourceId);
    setError(null);
    setRows([]);
    const result = await syncSource(dealId, sourceId).catch(() => ({ kind: 'error' as const, message: 'The data room could not be read. Try again.' }));
    if (result.kind === 'error') {
      setError(result.message);
      setSyncing(null);
      return;
    }
    const changed = result.files.filter((file) => file.outcome !== 'UNCHANGED');
    setRows(changed.map((file) => ({ path: file.path, outcome: file.outcome })));
    router.refresh();
    if (aiOn) {
      for (const file of changed) {
        if ((file.outcome !== 'NEW' && file.outcome !== 'UPDATED') || !file.documentId) continue;
        setRows((current) => current.map((row) => (row.path === file.path ? { ...row, sorting: true } : row)));
        const outcome = await sortDocument(dealId, file.documentId);
        setRows((current) => current.map((row) => (row.path === file.path ? { ...row, sorting: false, message: outcome.message } : row)));
        router.refresh();
      }
    }
    setSyncing(null);
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      {sources.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {sources.items.map((source) => (
            <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <span className="flex flex-col">
                <span className="font-medium">
                  {source.displayName} <span className="font-normal text-muted-foreground">· {source.providerLabel}{source.mode === 'FIXTURE' ? ' (synthetic)' : ''}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {source.lastSyncedAt
                    ? `Last read ${source.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC${source.lastSyncSummary ? ` — ${source.lastSyncSummary['NEW'] ?? 0} new, ${source.lastSyncSummary['UPDATED'] ?? 0} updated, ${source.lastSyncSummary['REMOVED'] ?? 0} removed` : ''}`
                    : 'Not read yet'}
                </span>
              </span>
              <Button type="button" size="sm" variant="outline" disabled={syncing !== null} onClick={() => void sync(source.id)}>
                {syncing === source.id ? 'Reading…' : 'Sync now'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="What the sync found" aria-live="polite">
          {rows.map((row) => (
            <li key={row.path} className="flex flex-col gap-1 px-3 py-2">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{row.path}</span>
                <Badge variant={row.outcome === 'REJECTED' || row.outcome === 'SKIPPED' ? 'danger' : row.outcome === 'REMOVED' ? 'draft' : 'reviewed'}>
                  {row.sorting ? 'Reading what it is…' : OUTCOME[row.outcome]}
                </Badge>
              </span>
              {row.message ? <span className="text-xs text-muted-foreground">{row.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <ConnectForm dealId={dealId} fixtureRooms={sources.fixtureRooms} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="self-start text-xs underline" onClick={() => setAdding(true)}>
          Connect another data room or drive
        </button>
      )}
    </div>
  );
}

function ConnectForm({ dealId, fixtureRooms, onDone }: { dealId: string; fixtureRooms: SourcesView['fixtureRooms']; onDone: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<'fixture' | 'google-drive' | 'onedrive'>(fixtureRooms.length > 0 ? 'fixture' : 'google-drive');
  const [room, setRoom] = useState(fixtureRooms[0]?.id ?? '');
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = PROVIDERS.find((provider) => provider.id === kind);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result =
      kind === 'fixture'
        ? await connectSource(dealId, { provider: 'vdr', mode: 'FIXTURE', displayName: fixtureRooms.find((r) => r.id === room)?.label ?? 'Synthetic data room', folder: room })
        : await connectSource(dealId, { provider: kind, mode: 'LIVE', displayName: name || (live?.label ?? 'Drive'), folder, token });
    setBusy(false);
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    setToken('');
    onDone();
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
      <label className="flex flex-wrap items-center gap-2">
        Read documents from
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="rounded-md border border-border bg-background px-2 py-1">
          {fixtureRooms.length > 0 ? <option value="fixture">A synthetic data room (test data)</option> : null}
          {PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
      {kind === 'fixture' ? (
        <select value={room} onChange={(event) => setRoom(event.target.value)} aria-label="Synthetic data room" className="rounded-md border border-border bg-background px-2 py-1">
          {fixtureRooms.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, e.g. Seller data room" aria-label="Name" className="rounded-md border border-border bg-background px-2 py-1" />
          <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder={live?.folderHint} aria-label="Folder" className="rounded-md border border-border bg-background px-2 py-1" />
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            type="password"
            autoComplete="off"
            placeholder="Read-only access token"
            aria-label="Read-only access token"
            className="rounded-md border border-border bg-background px-2 py-1"
          />
          <p className="text-xs text-muted-foreground">
            Read-only access is enough ({kind === 'google-drive' ? 'drive.readonly' : 'Files.Read'}). The token is stored in the secret store and never shown again. Pactlab never writes to
            the source.
          </p>
        </>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={busy || (kind === 'fixture' ? !room : !folder || !token)} onClick={() => void submit()}>
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}
