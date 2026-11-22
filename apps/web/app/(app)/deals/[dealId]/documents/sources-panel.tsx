'use client';

import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { connectSource, disconnectSource, signInForFolder, syncSource, type SourceSyncFile } from './actions';
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
  /** Reads with the organization's own sign-in (T-147), not a pasted token. */
  readonly viaOrganization?: boolean;
  /** How it reads: a person's own sign-in, the organization's, a pasted token, or synthetic data. */
  readonly kind?: 'PERSON' | 'ORGANIZATION' | 'TOKEN' | 'FIXTURE';
  readonly signedInAs?: string | null;
  /** Its files are shared with the deal (a seller's folder). */
  readonly shared?: boolean;
  readonly canDisconnect?: boolean;
}

export interface SourcesView {
  readonly items: readonly DocumentSourceView[];
  readonly fixtureRooms: readonly { readonly id: string; readonly label: string }[];
  /** Providers the organization has signed in to (Settings → Document sources). */
  readonly signedIn?: readonly string[];
  /** Providers anyone here may sign in to for a folder (Pactlab's client is set up). */
  readonly providers?: readonly { readonly provider: 'google-drive' | 'onedrive'; readonly label: string; readonly organizationSignedIn: boolean }[];
  /** The seller's own view: what they connect is shared with the deal team. */
  readonly seller?: boolean;
}

/** How a source reads, in words. */
export function readsWith(source: DocumentSourceView): string | null {
  if (source.kind === 'PERSON') return source.signedInAs ? `Signed in as ${source.signedInAs}` : 'Signed in for this folder';
  if (source.kind === 'ORGANIZATION' || source.viaOrganization) return 'Organization sign-in';
  if (source.kind === 'TOKEN') return 'Pasted access token';
  return null;
}

const OUTCOME: Record<SourceSyncFile['outcome'], string> = {
  NEW: 'New',
  UPDATED: 'New version',
  UNCHANGED: 'Unchanged',
  DUPLICATE: 'Already here',
  REMOVED: 'Removed at the source',
  SKIPPED: 'Not a file Pactlab reads',
  REJECTED: 'Refused',
  WAITING: 'Waiting for the next sync',
};

const PROVIDERS = [
  { id: 'google-drive', label: 'Google Drive', folderHint: 'Folder link, or its id' },
  { id: 'onedrive', label: 'OneDrive / SharePoint', folderHint: '<drive-id>/<folder-item-id>' },
] as const;

/** A folder as pasted: a Drive folder link becomes its id ("…/drive/folders/<id>?usp=sharing" → <id>); anything else as typed. */
export function folderFromInput(provider: string, text: string): string {
  const value = text.trim();
  if (provider !== 'google-drive') return value;
  const linked = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(value) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(value);
  return linked?.[1] ?? value;
}

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
export function SourcesPanel({ dealId, sources, aiOn, justConnected = null }: { dealId: string; sources: SourcesView; aiOn: boolean; justConnected?: string | null }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [adding, setAdding] = useState(sources.items.length === 0);
  // The deal team sorts what a seller connects, as with seller uploads.
  const sorting = aiOn && !sources.seller;

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
    // Large rooms are read across syncs (T-126): say what is left, never stop silently.
    setProgress(
      [
        result.waiting > 0 ? `${result.waiting} more file${result.waiting === 1 ? '' : 's'} to read — sync again to continue (up to 200 are read each time).` : null,
        result.complete ? null : `This room has more than ${result.listedLimit.toLocaleString('en-US')} files; only the first ${result.listedLimit.toLocaleString('en-US')} are listed, and nothing is marked removed until a sync can list it all.`,
      ]
        .filter(Boolean)
        .join(' ') || null,
    );
    const changed = result.files.filter((file) => file.outcome !== 'UNCHANGED' && file.outcome !== 'WAITING');
    setRows(changed.map((file) => ({ path: file.path, outcome: file.outcome })));
    router.refresh();
    if (sorting) {
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
  const disconnect = async (sourceId: string) => {
    const result = await disconnectSource(dealId, sourceId);
    if (result.kind === 'error') setError(result.message);
    router.refresh();
  };

  // Back from signing in for a folder: read it in once, by itself.
  const started = useRef(false);
  useEffect(() => {
    if (!justConnected || started.current || !sources.items.some((source) => source.id === justConnected && source.status === 'ACTIVE')) return;
    started.current = true;
    void sync(justConnected);
  }, [justConnected]);

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
                {readsWith(source) || source.shared ? (
                  <span className="text-xs text-muted-foreground">
                    {[readsWith(source), source.shared ? 'shared with the deal team' : null, source.status === 'DISABLED' ? 'disconnected' : null].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {source.lastSyncedAt
                    ? `Last read ${source.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC${source.lastSyncSummary ? ` — ${source.lastSyncSummary['NEW'] ?? 0} new, ${source.lastSyncSummary['UPDATED'] ?? 0} updated, ${source.lastSyncSummary['REMOVED'] ?? 0} removed${(source.lastSyncSummary['WAITING'] ?? 0) > 0 ? `, ${source.lastSyncSummary['WAITING']} still to read (sync again)` : ''}${source.lastSyncSummary['LISTING_COMPLETE'] === 0 ? ' — larger than one listing' : ''}` : ''}`
                    : 'Not read yet'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {source.status === 'ACTIVE' ? (
                  <Button type="button" size="sm" variant="outline" disabled={syncing !== null} onClick={() => void sync(source.id)}>
                    {syncing === source.id ? 'Reading…' : 'Sync now'}
                  </Button>
                ) : null}
                {source.canDisconnect ? (
                  <Button type="button" size="sm" variant="link" disabled={syncing !== null} onClick={() => void disconnect(source.id)}>
                    Disconnect
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {progress ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {progress}
        </p>
      ) : null}

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
        <ConnectForm
          dealId={dealId}
          fixtureRooms={sources.fixtureRooms}
          signedIn={sources.signedIn ?? []}
          providers={sources.providers ?? []}
          seller={sources.seller ?? false}
          onDone={() => setAdding(false)}
        />
      ) : (
        <Button variant="link" size="sm" className="self-start" type="button" onClick={() => setAdding(true)}>
          Connect another data room or drive
        </Button>
      )}
    </div>
  );
}

function ConnectForm({
  dealId,
  fixtureRooms,
  signedIn,
  providers,
  seller,
  onDone,
}: {
  dealId: string;
  fixtureRooms: SourcesView['fixtureRooms'];
  signedIn: readonly string[];
  providers: NonNullable<SourcesView['providers']>;
  seller: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const offered = PROVIDERS.filter((provider) => providers.some((entry) => entry.provider === provider.id) || signedIn.includes(provider.id));
  const [kind, setKind] = useState<'fixture' | 'google-drive' | 'onedrive'>(fixtureRooms.length > 0 ? 'fixture' : (offered[0]?.id ?? 'google-drive'));
  const [room, setRoom] = useState(fixtureRooms[0]?.id ?? '');
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = PROVIDERS.find((provider) => provider.id === kind);
  const canSignIn = kind !== 'fixture' && providers.some((entry) => entry.provider === kind);
  const organization = kind !== 'fixture' && signedIn.includes(kind);

  const useOrganization = async () => {
    setBusy(true);
    setError(null);
    const result =
      kind === 'fixture'
        ? await connectSource(dealId, { provider: 'vdr', mode: 'FIXTURE', displayName: fixtureRooms.find((r) => r.id === room)?.label ?? 'Synthetic data room', folder: room })
        : await connectSource(dealId, { provider: kind, mode: 'LIVE', displayName: name || (live?.label ?? 'Drive'), folder: folderFromInput(kind, folder) });
    setBusy(false);
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    onDone();
    router.refresh();
  };
  // Off to Google or Microsoft; back here signed in, and the folder reads in.
  const signIn = async () => {
    if (kind === 'fixture') return;
    setBusy(true);
    setError(null);
    const result = await signInForFolder(dealId, { provider: kind, displayName: name || (live?.label ?? 'Drive'), folder: folderFromInput(kind, folder) });
    setBusy(false);
    setError(result.message);
  };

  if (offered.length === 0 && fixtureRooms.length === 0) {
    return <p className="text-xs text-muted-foreground">Drive folders can’t be connected on this Pactlab yet. Upload the files instead.</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
      <label className="flex flex-wrap items-center gap-2">
        Read documents from
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="rounded-md border border-border bg-background px-2 py-1">
          {fixtureRooms.length > 0 ? <option value="fixture">A synthetic data room (test data)</option> : null}
          {offered.map((provider) => (
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
          <p className="text-xs text-muted-foreground">
            {seller
              ? `Sign in with your own ${live?.label} account. The files in this folder are shared with the deal team. `
              : `Sign in with your own ${live?.label} account for this folder${organization ? ', or use the organization’s sign-in' : ''}. `}
            Pactlab only reads; it never writes, moves or shares anything there.
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'fixture' ? (
          <Button type="button" size="sm" disabled={busy || !room} onClick={() => void useOrganization()}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        ) : (
          <>
            {canSignIn ? (
              <Button type="button" size="sm" disabled={busy || !folder} onClick={() => void signIn()}>
                {busy ? 'Opening…' : `Sign in with ${kind === 'google-drive' ? 'Google' : 'Microsoft'}`}
              </Button>
            ) : null}
            {organization ? (
              <Button type="button" size="sm" variant="outline" disabled={busy || !folder} onClick={() => void useOrganization()}>
                Use the organization’s {live?.label}
              </Button>
            ) : null}
          </>
        )}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}
