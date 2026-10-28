'use client';

import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { uploadArchive, uploadOne, type ArchiveFile } from './actions';
import { sortDocument } from './sorting';
import { ACCEPT, checkFile, guessDataClass, isArchive, UPLOAD_PROBLEMS } from './upload-rules';

type Status =
  | 'ready'
  | 'uploading'
  | 'unpacked'
  | 'uploaded'
  | 'duplicate'
  | 'failed'
  | 'skipped'
  | 'classifying'
  | 'filed'
  | 'needs-you'
  | 'extracting'
  | 'extracted'
  | 'not-extracted';

interface Item {
  readonly key: string;
  readonly name: string;
  /** Picked by the user; files unpacked from a zip have none. */
  readonly file?: File;
  /** The zip a file came out of, shown as its folder. */
  readonly from?: string;
  dataClass: 'BUSINESS' | 'FINANCIAL';
  aiExcluded: boolean;
  /** Shared with the other party at upload (T-097); never changed later. */
  shared: boolean;
  status: Status;
  message?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  ready: 'Ready to upload',
  uploading: 'Uploading…',
  unpacked: 'Unpacked',
  uploaded: 'Uploaded',
  duplicate: 'Already uploaded',
  failed: 'Upload failed',
  skipped: 'Not uploaded',
  classifying: 'Reading what it is…',
  filed: 'Filed',
  'needs-you': 'Pactlab needs you',
  extracting: 'Filed · AI extraction running…',
  extracted: 'Filed · AI drafts ready',
  'not-extracted': 'Uploaded · AI did not run',
};

const STATUS_TONE: Record<Status, 'neutral' | 'calculation' | 'danger' | 'reviewed' | 'draft'> = {
  ready: 'neutral',
  uploading: 'neutral',
  unpacked: 'reviewed',
  uploaded: 'reviewed',
  duplicate: 'neutral',
  failed: 'danger',
  skipped: 'danger',
  classifying: 'neutral',
  filed: 'reviewed',
  'needs-you': 'draft',
  extracting: 'neutral',
  extracted: 'reviewed',
  'not-extracted': 'danger',
};

const SKIP_REASONS: Readonly<Record<string, string>> = {
  UNSUPPORTED_TYPE: 'Pactlab does not read this kind of file (PDF, Word, Excel, CSV, text and Markdown only).',
  NESTED_TOO_DEEP: 'A zip inside a zip inside the zip — unpack it and upload it on its own.',
  TOO_LARGE: 'Too large (10 MB for PDF, Word and Excel; 512 KB for CSV, text and Markdown).',
  EMPTY_OR_UNREADABLE: 'Empty or unreadable.',
  UNREADABLE_OR_INFECTED: 'Unreadable, password-protected, a scanned PDF with no text, or flagged by the virus scan.',
  FAILED: 'The upload failed. Upload this file again on its own.',
};

/**
 * Upload (T-094 B1–B3, T-098): pick or drop many files, or a zip of a whole
 * data room. Every file — including each one unpacked from a zip — gets its
 * own row and state from the moment it is known. After upload the AI reads
 * what each file is and files it: contracts go on to extraction, structured
 * exports to their import, balance sheets to the debt-and-cash reader. When
 * it is unsure it asks, under "Pactlab needs you". Nothing is dropped silently.
 */
export function DocumentUploader({ dealId, aiOn, shareLabel = null }: { dealId: string; aiOn: boolean; shareLabel?: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const waiting = items.filter((item) => item.status === 'ready').length;

  useEffect(() => {
    if (waiting === 0 && !busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [waiting, busy]);

  const add = (files: FileList | null) => {
    if (!files) return;
    const added = [...files].map((file): Item => {
      const checked = checkFile(file.name, file.size);
      return {
        key: `${file.name}:${file.size}:${file.lastModified}:${Math.random()}`,
        name: file.name,
        file,
        dataClass: guessDataClass(file.name),
        aiExcluded: false,
        shared: false,
        status: 'problem' in checked ? 'failed' : 'ready',
        ...('problem' in checked ? { message: UPLOAD_PROBLEMS[checked.problem] } : {}),
      };
    });
    setItems((current) => [...current, ...added]);
    if (input.current) input.current.value = '';
  };

  const update = (key: string, change: Partial<Item>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  /** After upload: the AI files the document, then the next step for its kind runs. */
  const sort = async (key: string, documentId: string) => {
    if (!aiOn) {
      update(key, { status: 'uploaded', message: 'AI is off here; Pactlab will sort this file once it is switched on.' });
      return;
    }
    update(key, { status: 'classifying' });
    const outcome = await sortDocument(dealId, documentId, (message) => update(key, { status: 'extracting', message }));
    update(key, outcome);
  };

  const unpack = async (item: Item, form: FormData) => {
    const result = await uploadArchive(dealId, form).catch(() => ({ kind: 'error' as const, message: UPLOAD_PROBLEMS.failed }));
    if (result.kind === 'error') {
      update(item.key, { status: 'failed', message: result.message });
      return;
    }
    const count = (outcome: ArchiveFile['outcome']) => result.files.filter((file) => file.outcome === outcome).length;
    const refused = count('REJECTED') + count('SKIPPED');
    update(item.key, {
      status: 'unpacked',
      message: `${result.files.length} file(s) inside: ${count('UPLOADED')} uploaded, ${count('DUPLICATE')} already here${refused > 0 ? `, ${refused} not uploaded (listed below)` : ''}.`,
    });
    const children = result.files.map(
      (file): Item & { documentId: string | null } => ({
        key: `${item.key}/${file.path}`,
        name: file.path,
        from: item.name,
        dataClass: item.dataClass,
        aiExcluded: item.aiExcluded,
        shared: item.shared,
        documentId: file.documentId,
        status: file.outcome === 'UPLOADED' ? 'uploaded' : file.outcome === 'DUPLICATE' ? 'duplicate' : file.outcome === 'SKIPPED' ? 'skipped' : 'failed',
        ...(file.outcome === 'DUPLICATE' ? { message: 'Already in this deal; not added twice.' } : {}),
        ...(file.reason ? { message: SKIP_REASONS[file.reason] ?? SKIP_REASONS['FAILED'] } : {}),
      }),
    );
    setItems((current) => {
      const at = current.findIndex((entry) => entry.key === item.key);
      return [...current.slice(0, at + 1), ...children, ...current.slice(at + 1)];
    });
    router.refresh();
    for (const child of children) {
      if (child.status === 'uploaded' && child.documentId) await sort(child.key, child.documentId);
    }
  };

  const uploadAll = async () => {
    setBusy(true);
    for (const item of items.filter((entry) => entry.status === 'ready' && entry.file)) {
      update(item.key, { status: 'uploading', message: undefined });
      const form = new FormData();
      form.set('file', item.file as File);
      form.set('dataClass', item.dataClass);
      if (item.aiExcluded) form.set('aiExcluded', 'on');
      if (item.shared) form.set('shared', 'on');
      if (isArchive(item.name)) {
        await unpack(item, form);
        router.refresh();
        continue;
      }
      let result: Awaited<ReturnType<typeof uploadOne>>;
      try {
        result = await uploadOne(dealId, form);
      } catch {
        result = { kind: 'error', message: UPLOAD_PROBLEMS.failed };
      }
      if (result.kind === 'error') {
        update(item.key, { status: 'failed', message: result.message });
        continue;
      }
      if (result.duplicate) {
        update(item.key, { status: 'duplicate', message: 'The same file is already in this deal; it was not added twice.' });
        continue;
      }
      router.refresh();
      await sort(item.key, result.id);
      router.refresh();
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          add(event.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-6 text-center ${over ? 'border-primary bg-muted' : 'border-border'}`}
      >
        <span className="font-medium">Drop everything here — many files at once, or one zip of the whole data room</span>
        <span className="text-xs text-muted-foreground">PDF, Word, Excel and zip up to 10 MB; CSV, text and Markdown up to 512 KB. Pactlab works out what each file is.</span>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose documents" onChange={(event) => add(event.target.files)} />
      </label>

      {items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Files to upload" aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={item.from ? 'pl-4 font-medium' : 'font-medium'}>{item.name}</span>
                <Badge variant={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
              </div>
              {item.status === 'ready' ? (
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    Contains
                    <select
                      value={item.dataClass}
                      onChange={(event) => update(item.key, { dataClass: event.target.value === 'FINANCIAL' ? 'FINANCIAL' : 'BUSINESS' })}
                      className="rounded-md border border-border bg-background px-2 py-1"
                    >
                      <option value="BUSINESS">business information</option>
                      <option value="FINANCIAL">financial information</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={item.aiExcluded} onChange={(event) => update(item.key, { aiExcluded: event.target.checked })} /> Keep away from AI
                  </label>
                  {shareLabel ? (
                    <label className="flex items-center gap-2" title="Chosen now; it cannot be changed after upload.">
                      <input type="checkbox" checked={item.shared} onChange={(event) => update(item.key, { shared: event.target.checked })} /> {shareLabel}
                    </label>
                  ) : null}
                  <button type="button" className="text-muted-foreground underline" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>
                    Remove
                  </button>
                </div>
              ) : null}
              {item.message ? <p className={`text-xs ${item.status === 'failed' || item.status === 'skipped' || item.status === 'not-extracted' ? 'text-red-700' : 'text-muted-foreground'}`}>{item.message}</p> : null}
              {item.status === 'failed' && item.file && 'contentType' in checkFile(item.file.name, item.file.size) ? (
                <button type="button" className="self-start text-xs underline" onClick={() => update(item.key, { status: 'ready', message: undefined })}>
                  Try again
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={busy || waiting === 0} onClick={() => void uploadAll()}>
          {busy ? 'Uploading…' : waiting > 1 ? `Upload ${waiting} files` : 'Upload'}
        </Button>
        {items.length > 0 && !busy ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setItems((current) => current.filter((item) => item.status === 'ready'))}
          >
            Clear finished
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        With AI on, Pactlab reads each file as it arrives and files it: contracts go on to extraction, exports to their import, balance sheets to the debt-and-cash reader. When it is unsure it asks you.
        HR, pay and performance documents are never sent to a model.
      </p>
    </div>
  );
}
