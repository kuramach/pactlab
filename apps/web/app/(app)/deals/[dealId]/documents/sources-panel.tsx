'use client';

import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { addChosenFiles, connectSource, disconnectSource, pickerFor, signInForFolder, syncSource, type RinseSyncSummary, type SourceSyncFile } from './actions';
import { FolderChooser } from './folder-chooser';
import { chooseDriveFiles } from './google-picker';
import { sortDocument } from './sorting';
import { formatNumber } from '@pactlab/domain';

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
  /** Google Drive through the picker: how many files were chosen, and whether this person may choose more. */
  readonly filesChosen?: number | null;
  readonly canChooseFiles?: boolean;
  /** OneDrive: no folder chosen yet; and whether this person may choose it. */
  readonly needsFolder?: boolean;
  readonly canChooseFolder?: boolean;
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

export const OUTCOME: Record<SourceSyncFile['outcome'], string> = {
  NEW: 'New',
  UPDATED: 'New version',
  UNCHANGED: 'Unchanged',
  DUPLICATE: 'Already here',
  REMOVED: 'Removed at the source',
  SKIPPED: 'Not a file Pactlab reads',
  REJECTED: 'Refused',
  WAITING: 'Waiting for the next sync',
};

/** Why a file of a folder finished in Pactlab Rinse was handled as it was (T-178). */
export const RINSE_REASONS: Readonly<Record<string, string>> = {
  RINSE_MANIFEST: 'The Pactlab Rinse manifest: read for provenance, not kept as a document.',
  RINSE_ORIGINAL: 'The seller’s original: kept at the source. Its rinsed copy is read, and names it.',
  HAND_SOURCED_CLAIM: 'Hand-sourced: recorded as a seller claim, labelled hand-sourced. It is not documentary evidence.',
  NOT_IN_RINSE_MANIFEST: 'Added after the rinse. It isn’t in the manifest, so it wasn’t read. Ask the seller to rinse it.',
  CHANGED_SINCE_RINSE: 'Changed since the rinse, so it no longer matches the manifest. Ask the seller to rinse it again.',
};

/** The manifest's account of the set, in a few lines: who prepared it, what was audited, what travels as a note. */
export function rinseLines(rinse: RinseSyncSummary): string[] {
  if (rinse.status === 'INVALID') return ['This folder has a Pactlab Rinse manifest that Pactlab cannot read, so its files came in as an ordinary folder. Ask the seller to rinse it again.'];
  const lines = [
    `Finished in Pactlab Rinse by ${rinse.set?.preparedBy ?? 'the seller'}: ${rinse.documents} document${rinse.documents === 1 ? '' : 's'}, ${rinse.audited} conversion${rinse.audited === 1 ? '' : 's'} checked against the originals.`,
    ...rinse.notedGaps.map((gap) => `${gap.label}: ${gap.state === 'NOT_APPLICABLE' ? 'marked not applicable' : 'noted'} by the seller${gap.note ? `: “${gap.note}”` : ''}`),
    ...rinse.sourceDiscrepancies.map((item) => `${item.document} doesn’t add up in the seller’s own original. ${item.label} on page ${item.page} says ${item.stated}, but its lines sum to ${item.computed}. ${rinse.claimsWaitForDealTeam ? 'The deal team reviews it.' : 'Drafted as a finding for a person to decide.'}`),
    ...rinse.handSourced.map((entry) => `${entry.title}: entered by hand, ${entry.claimId ? 'in the claims register as a hand-sourced seller claim' : 'becomes a seller claim when the deal team syncs'}.`),
  ];
  return lines;
}

const PROVIDERS = [
  { id: 'google-drive', label: 'Google Drive', folderHint: '' },
  { id: 'onedrive', label: 'OneDrive / SharePoint', folderHint: '<drive-id>/<folder-item-id>' },
] as const;

/**
 * What each provider reads, said where people choose it and on every source (Kumar, 2026-11-24). Google
 * Drive is read through Google's picker under `drive.file`: only the files chosen, never the rest of a
 * folder. OneDrive reads the whole folder, including files added later.
 */
export const GOOGLE_LIMIT =
  'With Google Drive, you pick the files to share. Files you add to the folder later won’t appear here until you add them too (use Add files). Changes to files you picked do come through.';
export const ONEDRIVE_READS = 'With OneDrive, you pick a folder next. Everything in it is shared with this pact, including files you add later.';

/** What a source reads, in a few words, for its row. */
export function readsWhat(source: DocumentSourceView): string | null {
  if (source.provider === 'google-drive' && typeof source.filesChosen === 'number') return `${source.filesChosen} file${source.filesChosen === 1 ? '' : 's'} shared · new files in the folder need Add files`;
  if (source.provider === 'onedrive' && source.mode === 'LIVE') return source.needsFolder ? 'No folder chosen yet' : 'Whole folder · new files come in automatically';
  return null;
}

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
  /** A Rinse manifest settled what happened to it (kept at the source, a claim): not a refusal. */
  readonly settledByRinse?: boolean;
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
  const [rinse, setRinse] = useState<RinseSyncSummary | null>(null);
  const [adding, setAdding] = useState(sources.items.length === 0);
  // The OneDrive source whose folder is being chosen in Pactlab's chooser.
  const [choosingFolder, setChoosingFolder] = useState<string | null>(null);
  // The deal team sorts what a seller connects, as with seller uploads.
  const sorting = aiOn && !sources.seller;

  const sync = async (sourceId: string) => {
    setSyncing(sourceId);
    setError(null);
    setRows([]);
    setRinse(null);
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
        result.complete ? null : `This room has more than ${formatNumber(result.listedLimit)} files; only the first ${formatNumber(result.listedLimit)} are listed, and nothing is marked removed until a sync can list it all.`,
      ]
        .filter(Boolean)
        .join(' ') || null,
    );
    const changed = result.files.filter((file) => file.outcome !== 'UNCHANGED' && file.outcome !== 'WAITING');
    setRows(changed.map((file) => ({ path: file.path, outcome: file.outcome, ...(file.reason && RINSE_REASONS[file.reason] ? { message: RINSE_REASONS[file.reason], settledByRinse: file.outcome === 'SKIPPED' } : {}) })));
    setRinse(result.rinse);
    router.refresh();
    // Files the Rinse manifest filed keep the seller's classification; only the rest are sorted by the AI.
    const filed = new Set(result.rinse?.filed ?? []);
    if (sorting) {
      for (const file of changed) {
        if ((file.outcome !== 'NEW' && file.outcome !== 'UPDATED') || !file.documentId || filed.has(file.documentId)) continue;
        setRows((current) => current.map((row) => (row.path === file.path ? { ...row, sorting: true } : row)));
        const outcome = await sortDocument(dealId, file.documentId);
        setRows((current) => current.map((row) => (row.path === file.path ? { ...row, sorting: false, message: outcome.message } : row)));
        router.refresh();
      }
    }
    setSyncing(null);
  };
  // Google's picker, opened over the page with this person's own short-lived token; the chosen files are read next.
  const choose = async (sourceId: string) => {
    setError(null);
    const keys = await pickerFor(dealId, sourceId);
    if (keys.kind === 'error') {
      setError(keys.message);
      return;
    }
    let chosen: string[];
    try {
      chosen = await chooseDriveFiles(keys);
    } catch {
      setError('Google’s file picker could not open. Check that pop-ups and third-party content from Google are allowed, then try again.');
      return;
    }
    if (chosen.length === 0) return;
    const added = await addChosenFiles(dealId, sourceId, chosen);
    if (added.kind === 'error') {
      setError(added.message);
      return;
    }
    await sync(sourceId);
  };
  const disconnect = async (sourceId: string) => {
    const result = await disconnectSource(dealId, sourceId);
    if (result.kind === 'error') setError(result.message);
    router.refresh();
  };

  // Back from signing in: Google Drive opens the picker to choose files; a OneDrive folder reads in by itself.
  const started = useRef(false);
  useEffect(() => {
    const source = justConnected ? sources.items.find((item) => item.id === justConnected && item.status === 'ACTIVE') : undefined;
    if (!source || started.current) return;
    started.current = true;
    if (source.canChooseFiles && !source.filesChosen) void choose(source.id);
    else if (source.canChooseFolder && source.needsFolder) setChoosingFolder(source.id);
    else void sync(source.id);
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
                {readsWhat(source) ? <span className="text-xs text-muted-foreground">{readsWhat(source)}</span> : null}
                <span className="text-xs text-muted-foreground">
                  {source.lastSyncedAt
                    ? `Last read ${source.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC${source.lastSyncSummary ? ` — ${source.lastSyncSummary['NEW'] ?? 0} new, ${source.lastSyncSummary['UPDATED'] ?? 0} updated, ${source.lastSyncSummary['REMOVED'] ?? 0} removed${(source.lastSyncSummary['WAITING'] ?? 0) > 0 ? `, ${source.lastSyncSummary['WAITING']} still to read (sync again)` : ''}${source.lastSyncSummary['LISTING_COMPLETE'] === 0 ? ' — larger than one listing' : ''}` : ''}`
                    : 'Not read yet'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {source.canChooseFolder && source.needsFolder ? (
                  <Button type="button" size="sm" disabled={syncing !== null} onClick={() => setChoosingFolder(source.id)}>
                    Choose folder
                  </Button>
                ) : null}
                {source.canChooseFiles ? (
                  <Button type="button" size="sm" variant="outline" disabled={syncing !== null} onClick={() => void choose(source.id)}>
                    Add files
                  </Button>
                ) : null}
                {source.status === 'ACTIVE' && !source.needsFolder ? (
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

      {choosingFolder ? (
        <FolderChooser
          dealId={dealId}
          sourceId={choosingFolder}
          onChosen={() => {
            const id = choosingFolder;
            setChoosingFolder(null);
            router.refresh();
            void sync(id);
          }}
          onCancel={() => setChoosingFolder(null)}
        />
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {progress ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {progress}
        </p>
      ) : null}

      {rinse ? (
        <ul role="status" aria-label="From the Pactlab Rinse manifest" className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-xs">
          {rinseLines(rinse).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="What the sync found" aria-live="polite">
          {rows.map((row) => (
            <li key={row.path} className="flex flex-col gap-1 px-3 py-2">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{row.path}</span>
                <Badge variant={row.settledByRinse ? 'reviewed' : row.outcome === 'REJECTED' || row.outcome === 'SKIPPED' ? 'danger' : row.outcome === 'REMOVED' ? 'draft' : 'reviewed'}>
                  {row.sorting ? 'Reading what it is…' : row.settledByRinse ? 'Handled by the manifest' : OUTCOME[row.outcome]}
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
          onDone={(id) => {
            setAdding(false);
            // A OneDrive folder through the organization's sign-in: choose it right away.
            if (id) setChoosingFolder(id);
          }}
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
  onDone: (sourceId?: string) => void;
}) {
  const router = useRouter();
  const offered = PROVIDERS.filter((provider) => providers.some((entry) => entry.provider === provider.id));
  const [kind, setKind] = useState<'fixture' | 'google-drive' | 'onedrive'>(offered[0]?.id ?? (fixtureRooms.length > 0 ? 'fixture' : 'google-drive'));
  const [room, setRoom] = useState(fixtureRooms[0]?.id ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = PROVIDERS.find((provider) => provider.id === kind);
  // OneDrive through the organization's sign-in, when there is one: no second sign-in.
  const organization = kind === 'onedrive' && signedIn.includes('onedrive');
  const displayName = name.trim() || (seller ? 'My documents' : 'Data room');

  const connect = async (useOrganization: boolean) => {
    setBusy(true);
    setError(null);
    if (kind === 'fixture') {
      const result = await connectSource(dealId, { provider: 'vdr', mode: 'FIXTURE', displayName: fixtureRooms.find((r) => r.id === room)?.label ?? 'Synthetic data room', folder: room });
      setBusy(false);
      if (result.kind === 'error') setError(result.message);
      else {
        onDone();
        router.refresh();
      }
      return;
    }
    if (useOrganization) {
      const result = await connectSource(dealId, { provider: 'onedrive', mode: 'LIVE', displayName, folder: '' });
      setBusy(false);
      if (result.kind === 'error') setError(result.message);
      else {
        onDone(result.id);
        router.refresh();
      }
      return;
    }
    // Off to Google or Microsoft to sign in; back here to pick files (Google) or a folder (OneDrive).
    const result = await signInForFolder(dealId, { provider: kind, displayName, folder: '' });
    setBusy(false);
    setError(result.message);
  };

  if (offered.length === 0 && fixtureRooms.length === 0) {
    return <p className="text-xs text-muted-foreground">Connecting Google Drive or OneDrive isn’t set up on this Pactlab yet. You can upload files instead.</p>;
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
      <div className="flex flex-col gap-2">
        <span className="font-medium">Add documents from</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Add documents from">
          {offered.map((provider) => (
            <Button key={provider.id} type="button" size="sm" role="radio" aria-checked={kind === provider.id} variant={kind === provider.id ? 'default' : 'outline'} onClick={() => setKind(provider.id)}>
              {provider.label}
            </Button>
          ))}
          {fixtureRooms.length > 0 ? (
            <Button type="button" size="sm" role="radio" aria-checked={kind === 'fixture'} variant={kind === 'fixture' ? 'default' : 'outline'} onClick={() => setKind('fixture')}>
              Test data room
            </Button>
          ) : null}
        </div>
      </div>
      {kind === 'fixture' ? (
        <select value={room} onChange={(event) => setRoom(event.target.value)} aria-label="Test data room" className="rounded-md border border-border bg-background px-2 py-1">
          {fixtureRooms.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Name (optional)
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={seller ? 'My documents' : 'Data room'} aria-label="Name" className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
          </label>
          <p role="note" className={`rounded-md px-3 py-2 text-xs ${kind === 'google-drive' ? 'border border-amber-200 bg-amber-50 text-amber-950' : 'bg-muted text-foreground'}`}>
            {kind === 'google-drive' ? GOOGLE_LIMIT : ONEDRIVE_READS}
          </p>
          <p className="text-xs text-muted-foreground">
            {seller ? 'What you share here is visible to the deal team. ' : ''}Pactlab only reads your files. It never changes, moves or deletes anything.
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'fixture' ? (
          <Button type="button" size="sm" disabled={busy || !room} onClick={() => void connect(false)}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        ) : organization ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => void connect(true)}>
              {busy ? 'Connecting…' : `Connect ${live?.label}`}
            </Button>
            <Button type="button" size="sm" variant="link" disabled={busy} onClick={() => void connect(false)}>
              Use a different Microsoft account
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" disabled={busy} onClick={() => void connect(false)}>
            {busy ? 'Opening…' : `Connect ${live?.label}`}
          </Button>
        )}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}
