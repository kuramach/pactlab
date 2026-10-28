'use client';

import { Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { citationHref, type DocumentListItem } from '../../../documents/_lib/view';
import { extractOne } from './actions';

export interface LibraryRow extends DocumentListItem {
  /** AI drafts and decided findings citing this document. */
  readonly findings: number;
  readonly pending: number;
}

type SortKey = 'name' | 'uploaded' | 'pages' | 'findings';

const KIND: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'text/csv': 'CSV',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
};

export const kindOf = (contentType: string) => KIND[contentType] ?? 'File';

/** Rows matching the search and type filter, in the chosen order. */
export function libraryRows(rows: readonly LibraryRow[], query: string, kind: string, sort: SortKey, descending: boolean): LibraryRow[] {
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((row) => (!needle || row.fileName.toLowerCase().includes(needle)) && (kind === 'ALL' || kindOf(row.contentType) === kind));
  const value = (row: LibraryRow): string | number =>
    sort === 'name' ? row.fileName.toLowerCase() : sort === 'uploaded' ? row.createdAt : sort === 'pages' ? row.pageCount : row.findings;
  return [...filtered].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const order = left < right ? -1 : left > right ? 1 : a.fileName.localeCompare(b.fileName);
    return descending ? -order : order;
  });
}

function aiState(row: LibraryRow, aiOn: boolean): { label: string; tone: 'neutral' | 'reviewed' | 'draft' } {
  if (row.status === 'PURGED') return { label: 'Purged', tone: 'neutral' };
  if (row.aiExcluded) return { label: 'Kept away from AI', tone: 'neutral' };
  if (row.findings > 0) return row.pending > 0 ? { label: `${row.pending} to review`, tone: 'draft' } : { label: 'Reviewed', tone: 'reviewed' };
  return { label: aiOn ? 'No drafts yet' : 'AI off', tone: 'neutral' };
}

/**
 * The deal's document library (T-094 B11): every document with its type,
 * pages, upload date, AI state and finding count; search, filter by type,
 * sort by any column; select several to re-run AI extraction. Clicking a
 * name opens it in the page pane. Reads cleanly at 20+ documents.
 */
export function DocumentLibrary({ dealId, rows, openId, aiOn, writer }: { dealId: string; rows: readonly LibraryRow[]; openId?: string; aiOn: boolean; writer: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('uploaded');
  const [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const kinds = useMemo(() => [...new Set(rows.map((row) => kindOf(row.contentType)))].sort(), [rows]);
  const shown = libraryRows(rows, query, kind, sort, descending);

  const sortBy = (key: SortKey) => {
    if (sort === key) setDescending((value) => !value);
    else {
      setSort(key);
      setDescending(key !== 'name');
    }
  };
  const header = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort === key ? (descending ? 'descending' : 'ascending') : 'none'} className="px-2 py-2 font-medium">
      <button type="button" onClick={() => sortBy(key)} className="hover:underline">
        {label}
        {sort === key ? (descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  const rerun = async () => {
    const ids = shown.filter((row) => selected.has(row.id) && !row.aiExcluded && row.status === 'AVAILABLE').map((row) => row.id);
    let drafted = 0;
    const problems: string[] = [];
    for (const id of ids) {
      setRunning(id);
      const result = await extractOne(dealId, id).catch(() => ({ kind: 'error' as const, message: 'AI extraction failed.' }));
      if (result.kind === 'ok') drafted += result.drafted;
      else problems.push(`${rows.find((row) => row.id === id)?.fileName}: ${result.message}`);
      router.refresh();
    }
    setRunning(null);
    setSelected(new Set());
    setNote(problems.length ? problems.join(' ') : `AI extraction finished on ${ids.length} document(s): ${drafted} new cited draft(s).`);
  };

  const allShownSelected = shown.length > 0 && shown.every((row) => selected.has(row.id));

  return (
    <nav aria-label="Documents" className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search documents"
          aria-label="Search documents"
          className="w-56 rounded-md border border-border bg-background px-3 py-1.5"
        />
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filter by type" className="rounded-md border border-border bg-background px-2 py-1.5">
          <option value="ALL">All types</option>
          {kinds.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">
          {shown.length} of {rows.length} document{rows.length === 1 ? '' : 's'}
        </span>
        {writer && aiOn && selected.size > 0 ? (
          <Button type="button" size="sm" variant="outline" disabled={running !== null} onClick={() => void rerun()}>
            {running ? 'Running AI extraction…' : `Re-run AI extraction on ${selected.size}`}
          </Button>
        ) : null}
      </div>
      {note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown documents"
                  checked={allShownSelected}
                  onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((row) => row.id)))}
                />
              </th>
              {header('name', 'Name')}
              <th scope="col" className="px-2 py-2 font-medium">
                Type
              </th>
              {header('pages', 'Pages')}
              {header('uploaded', 'Uploaded')}
              <th scope="col" className="px-2 py-2 font-medium">
                AI
              </th>
              {header('findings', 'Findings')}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const state = aiState(row, aiOn);
              return (
                <tr key={row.id} className={`border-t border-border ${row.id === openId ? 'bg-muted' : ''}`}>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.fileName}`}
                      checked={selected.has(row.id)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Link href={citationHref(dealId, { documentId: row.id, pageNumber: 1 })} scroll={false} className="font-medium hover:underline" aria-current={row.id === openId ? 'page' : undefined}>
                      {row.fileName}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{kindOf(row.contentType)}</td>
                  <td className="px-2 py-2 tabular-nums">{row.status === 'PURGED' ? '—' : `${row.pageCount} pp`}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">{row.createdAt.slice(0, 10)}</td>
                  <td className="px-2 py-2">
                    <Badge variant={state.tone}>{running === row.id ? 'Extracting…' : state.label}</Badge>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{row.findings}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </nav>
  );
}
