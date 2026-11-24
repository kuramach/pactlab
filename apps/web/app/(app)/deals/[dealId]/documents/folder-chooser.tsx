'use client';

import { Button } from '@pactlab/ui';
import { ChevronRight, Folder, FolderSymlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { chooseFolder, listFolders, type DriveFolder } from './actions';

/**
 * Choose a OneDrive folder in Pactlab (Kumar, 2026-11-24: "assume technical level for these users is
 * minimal"). No links or ids: My files, click into folders, "Use this folder".
 */
export function FolderChooser({ dealId, sourceId, onChosen, onCancel }: { dealId: string; sourceId: string; onChosen: () => void; onCancel: () => void }) {
  // The path from My files to here; empty is My files itself.
  const [path, setPath] = useState<DriveFolder[]>([]);
  const [folders, setFolders] = useState<DriveFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = path.at(-1);

  useEffect(() => {
    let stale = false;
    setFolders(null);
    setError(null);
    void listFolders(dealId, sourceId, here ? { driveId: here.driveId, itemId: here.itemId } : undefined).then((result) => {
      if (stale) return;
      if (result.kind === 'ok') setFolders(result.folders);
      else setError(result.message);
    });
    return () => {
      stale = true;
    };
  }, [dealId, sourceId, here]);

  const use = async () => {
    if (!here) return;
    setBusy(true);
    const result = await chooseFolder(dealId, sourceId, { driveId: here.driveId, itemId: here.itemId });
    setBusy(false);
    if (result.kind === 'error') setError(result.message);
    else onChosen();
  };

  return (
    <section aria-label="Choose a OneDrive folder" className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <p className="font-medium">Choose the folder to share with this pact</p>
      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-xs">
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setPath([])}>
          My files
        </Button>
        {path.map((folder, index) => (
          <span key={`${folder.driveId}/${folder.itemId}`} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setPath(path.slice(0, index + 1))}>
              {folder.name}
            </Button>
          </span>
        ))}
      </nav>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {folders === null && !error ? <p className="text-xs text-muted-foreground">Loading your folders…</p> : null}
      {folders && folders.length === 0 ? <p className="text-xs text-muted-foreground">{here ? 'No folders inside this one. You can use it as it is.' : 'No folders in My files yet.'}</p> : null}
      {folders && folders.length > 0 ? (
        <ul className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-border" aria-label="Folders">
          {folders.map((folder) => (
            <li key={`${folder.driveId}/${folder.itemId}`} className="border-t border-border first:border-t-0">
              <Button type="button" variant="ghost" className="flex h-auto w-full items-center justify-start gap-2 rounded-none px-3 py-2 text-left text-sm font-normal" onClick={() => setPath([...path, folder])}>
                {folder.shared ? <FolderSymlink className="h-4 w-4 text-indigo-ink" aria-hidden /> : <Folder className="h-4 w-4 text-indigo-ink" aria-hidden />}
                <span className="flex-1">{folder.name}</span>
                {folder.shared ? <span className="text-xs text-muted-foreground">shared with you</span> : null}
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Can’t see a folder someone shared with you? Open it in OneDrive, choose <strong>Add shortcut to My files</strong>, then come back here.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={!here || busy} onClick={() => void use()}>
          {busy ? 'Saving…' : here ? `Use “${here.name}”` : 'Open a folder to use it'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Not now
        </Button>
      </div>
    </section>
  );
}
