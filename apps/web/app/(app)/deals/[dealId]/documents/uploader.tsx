'use client';

import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { extractOne, uploadOne } from './actions';
import { ACCEPT, checkFile, guessDataClass, UPLOAD_PROBLEMS } from './upload-rules';

type Status = 'ready' | 'uploading' | 'uploaded' | 'duplicate' | 'failed' | 'extracting' | 'extracted' | 'not-extracted';

interface Item {
  readonly key: string;
  readonly file: File;
  dataClass: 'BUSINESS' | 'FINANCIAL';
  aiExcluded: boolean;
  status: Status;
  message?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  ready: 'Ready to upload',
  uploading: 'Uploading…',
  uploaded: 'Uploaded',
  duplicate: 'Already uploaded',
  failed: 'Upload failed',
  extracting: 'AI extraction running…',
  extracted: 'Uploaded · AI drafts ready',
  'not-extracted': 'Uploaded · AI extraction did not run',
};

const STATUS_TONE: Record<Status, 'neutral' | 'calculation' | 'danger' | 'reviewed'> = {
  ready: 'neutral',
  uploading: 'neutral',
  uploaded: 'reviewed',
  duplicate: 'neutral',
  failed: 'danger',
  extracting: 'neutral',
  extracted: 'reviewed',
  'not-extracted': 'danger',
};

/**
 * Multi-file document upload (T-094 B1–B3). Every chosen file is listed with
 * its own state from the moment it is picked; files upload one at a time,
 * and each starts its own AI extraction as soon as it is in. A failure is
 * shown on that file's row when it happens. Leaving the page with files
 * still waiting asks first, so a chosen file is never silently dropped.
 */
export function DocumentUploader({ dealId, aiOn }: { dealId: string; aiOn: boolean }) {
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
        file,
        dataClass: guessDataClass(file.name),
        aiExcluded: false,
        status: 'problem' in checked ? 'failed' : 'ready',
        ...('problem' in checked ? { message: UPLOAD_PROBLEMS[checked.problem] } : {}),
      };
    });
    setItems((current) => [...current, ...added]);
    if (input.current) input.current.value = '';
  };

  const update = (key: string, change: Partial<Item>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const uploadAll = async () => {
    setBusy(true);
    for (const item of items.filter((entry) => entry.status === 'ready')) {
      update(item.key, { status: 'uploading', message: undefined });
      const form = new FormData();
      form.set('file', item.file);
      form.set('dataClass', item.dataClass);
      if (item.aiExcluded) form.set('aiExcluded', 'on');
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
      if (!aiOn || item.aiExcluded) {
        update(item.key, { status: 'uploaded', message: item.aiExcluded ? 'Kept away from AI.' : 'AI is off here; drafts appear once it is switched on.' });
        continue;
      }
      update(item.key, { status: 'extracting' });
      let extracted: Awaited<ReturnType<typeof extractOne>>;
      try {
        extracted = await extractOne(dealId, result.id);
      } catch {
        extracted = { kind: 'error', message: 'AI extraction failed. Use “Re-run AI extraction” on the document to try again.' };
      }
      if (extracted.kind === 'ok') update(item.key, { status: 'extracted', message: `${extracted.drafted} new cited draft(s) in the review queue.` });
      else update(item.key, { status: extracted.kind === 'skipped' ? 'uploaded' : 'not-extracted', message: extracted.message });
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
        <span className="font-medium">Drop files here, or click to choose — several at once is fine</span>
        <span className="text-xs text-muted-foreground">PDF, Word and Excel up to 10 MB; CSV, text and Markdown up to 512 KB</span>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose documents" onChange={(event) => add(event.target.files)} />
      </label>

      {items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Files to upload" aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{item.file.name}</span>
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
                  <button type="button" className="text-muted-foreground underline" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>
                    Remove
                  </button>
                </div>
              ) : null}
              {item.message ? <p className={`text-xs ${item.status === 'failed' || item.status === 'not-extracted' ? 'text-red-700' : 'text-muted-foreground'}`}>{item.message}</p> : null}
              {item.status === 'failed' && 'contentType' in checkFile(item.file.name, item.file.size) ? (
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
        Word documents are split into sections and each Excel sheet starts a new page. HR, pay and performance documents are never sent to a model. With AI on, extraction starts for each document as soon
        as it is uploaded.
      </p>
    </div>
  );
}
