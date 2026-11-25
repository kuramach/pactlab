'use client';

import type { ImportGuidanceBody } from '@pactlab/contracts';
import { GUIDANCE_MAX_NOTE, GUIDANCE_MAX_TEXT, GUIDANCE_STARTERS, normalizeGuidance, rangeLabel } from '@pactlab/domain';
import { Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { saveGuidance } from '../actions';

const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** The grid's first rows, as the assistant numbers them (non-empty rows from 1), cut short for choosing rows. */
const gist = (cells: readonly string[]) => {
  const text = cells.filter(Boolean).slice(0, 4).join(' · ');
  return text.length > 70 ? `${text.slice(0, 70)}…` : text || '(blank)';
};

/**
 * What the AI was told about this file (T-152), quoted back, and editable: free text plus notes on
 * rows. Select rows in the grid, type the note, save; saving reads the file again with the guidance.
 */
export function GuidancePanel({
  dealId,
  uploadId,
  guidance,
  grid,
  disabled,
  explaining = false,
}: {
  dealId: string;
  uploadId: string;
  guidance: ImportGuidanceBody | null;
  grid: string[][];
  disabled: boolean;
  /** The person said the reading was not quite right: open, in view, ready to type. */
  explaining?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(guidance?.instructions ?? '');
  const [notes, setNotes] = useState<ImportGuidanceBody['annotations']>(guidance?.annotations ?? []);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(guidance !== null || explaining);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!explaining) return;
    panel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    panel.current?.querySelector('textarea')?.focus();
  }, [explaining]);
  const rows = grid.slice(0, 30);

  const toggle = (row: number) => setSelected((current) => new Set(current.has(row) ? [...current].filter((entry) => entry !== row) : [...current, row]));
  // A range is the first to the last selected row.
  const addNote = () => {
    if (selected.size === 0 || note.trim() === '') return;
    const picked = [...selected];
    setNotes((current) => normalizeGuidance({ instructions: '', annotations: [...current, { fromRow: Math.min(...picked), toRow: Math.max(...picked), note }] })?.annotations.map((entry) => ({ ...entry })) ?? current);
    setSelected(new Set());
    setNote('');
  };
  const save = () =>
    startTransition(async () => {
      const result = await saveGuidance(dealId, uploadId, { instructions: text, annotations: [...notes] });
      if (result.message) setMessage(result.message);
      else {
        setMessage(null);
        router.refresh();
      }
    });

  return (
    <section ref={panel} aria-label="Guide the AI" className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Guide the AI</span>
        {open ? null : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
            Add instructions or row notes
          </Button>
        )}
      </div>
      {guidance ? (
        <figure className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2">
          <figcaption className="text-xs text-muted-foreground">The AI was told:</figcaption>
          {guidance.instructions ? <blockquote className="border-l-2 border-border pl-2">{guidance.instructions}</blockquote> : null}
          {guidance.annotations.map((entry) => (
            <blockquote key={`${entry.fromRow}-${entry.toRow}`} className="border-l-2 border-border pl-2">
              <span className="font-medium">{rangeLabel(entry)}:</span> {entry.note}
            </blockquote>
          ))}
        </figure>
      ) : (
        <p className="text-muted-foreground">Nothing yet. Tell the AI how to read this file instead of correcting the mapping afterwards.</p>
      )}
      {open ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 font-medium">
            Instructions for the whole file
            <textarea
              aria-label="Instructions for the whole file"
              rows={2}
              maxLength={GUIDANCE_MAX_TEXT}
              className={inputClass}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="For example: this is a rent roll, amounts are monthly"
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Starter instructions">
            {GUIDANCE_STARTERS.map((starter) => (
              <Button key={starter} size="sm" variant="outline" onClick={() => setText((current) => (current.includes(starter) ? current : `${current.trim()}${current.trim() ? '. ' : ''}${starter}.`))}>
                {starter}
              </Button>
            ))}
          </div>
          {rows.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium">Notes on rows: select the rows, then say what they are</legend>
              <div className="max-h-56 overflow-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <tbody>
                    {rows.map((cells, index) => (
                      <tr key={index} className={selected.has(index + 1) ? 'bg-sky-50' : undefined}>
                        <td className="w-8 px-2 py-1">
                          <input type="checkbox" aria-label={`Select row ${index + 1}`} checked={selected.has(index + 1)} onChange={() => toggle(index + 1)} />
                        </td>
                        <td className="w-14 px-1 py-1 text-muted-foreground">Row {index + 1}</td>
                        <td className="truncate px-1 py-1 font-mono">{gist(cells)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-60 flex-1 flex-col gap-1 font-medium">
                  Note for {selected.size > 0 ? rangeLabel({ fromRow: Math.min(...selected), toRow: Math.max(...selected) }) : 'the selected rows'}
                  <input
                    aria-label="Note for the selected rows"
                    className={inputClass}
                    maxLength={GUIDANCE_MAX_NOTE}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="For example: title rows, skip them"
                  />
                </label>
                <Button size="sm" variant="outline" onClick={addNote} disabled={selected.size === 0 || note.trim() === ''}>
                  Add note
                </Button>
              </div>
            </fieldset>
          ) : null}
          {notes.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {notes.map((entry) => (
                <li key={`${entry.fromRow}-${entry.toRow}`} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{rangeLabel(entry)}:</span> {entry.note}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setNotes((current) => current.filter((other) => other !== entry))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={pending || disabled}>
              Save and read the file again
            </Button>
            <span className="text-xs text-muted-foreground">Guidance steers the mapping only. Values are read from the cells, and totals are still checked.</span>
          </div>
          {message ? (
            <p role="alert" className="text-red-700">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
