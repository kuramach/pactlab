'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { cn } from '../utils';

/**
 * An obvious file picker: a drop zone with a "Choose file" button that shows
 * the chosen file's name and size. It wraps a real `<input type="file">` (same
 * `name`, `accept` and `required`), so plain server-action forms keep working.
 */
export function FileDrop({
  name,
  accept,
  required,
  hint,
  formats,
  className,
}: {
  name: string;
  /** Passed to the input, e.g. ".csv,text/csv". */
  accept: string;
  required?: boolean;
  /** One line under the button, e.g. "CSV (UTF-8), up to 10 MB". */
  hint: string;
  /** Short format badges, e.g. ["CSV"] or ["PDF", "Word", "Text"]. */
  formats?: readonly string[];
  className?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [over, setOver] = useState(false);

  const describe = (chosen: File | undefined) => setFile(chosen ? { name: chosen.name, size: chosen.size } : null);
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files;
    if (!input.current || dropped.length === 0) return;
    input.current.files = dropped;
    describe(dropped[0]);
  };
  const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

  return (
    <label
      htmlFor={id}
      data-file-drop=""
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center text-sm transition-colors',
        over ? 'border-indigo-ink bg-indigo/10' : file ? 'border-emerald-400 bg-emerald-50' : 'border-navy/20 bg-mist hover:border-indigo-ink',
        className,
      )}
    >
      <input
        ref={input}
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        className="sr-only"
        onChange={(event) => describe(event.target.files?.[0])}
      />
      {file ? (
        <>
          <span className="font-semibold text-navy">{file.name}</span>
          <span className="text-xs text-slate-text">{size(file.size)} · click or drop to replace</span>
        </>
      ) : (
        <>
          <span className="rounded-lg bg-navy px-4 py-2 font-semibold text-white">Choose file</span>
          <span className="text-slate-text">or drag and drop it here</span>
        </>
      )}
      <span className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
        {formats?.map((format) => (
          <span key={format} className="rounded-full border border-navy/15 px-2 py-0.5 font-semibold">
            {format}
          </span>
        ))}
        <span>{hint}</span>
      </span>
    </label>
  );
}
