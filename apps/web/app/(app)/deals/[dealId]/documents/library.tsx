'use client';

import { Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { libraryHref } from './library-href';
import { DOCUMENT_KINDS } from '@pactlab/contracts';
import { useState } from 'react';
import { citationHref, visionLine, type DocumentListItem } from '../../../documents/_lib/view';
import { classifyOne, extractOne, readImagesAgain } from './actions';

export interface LibraryRow extends DocumentListItem {
  /** AI drafts and decided findings citing this document. */
  readonly findings: number;
  readonly pending: number;
}

type SortKey = 'name' | 'uploaded' | 'pages';

const KIND: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'text/csv': 'CSV',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'image/png': 'Image',
  'image/jpeg': 'Image',
};

export const kindOf = (contentType: string) => KIND[contentType] ?? 'File';

/** What intake made of the file (T-098), for the Category column. */
export function categoryCell(row: Pick<LibraryRow, 'intake'>, labels: Readonly<Record<string, string>>): { label: string; tone: 'neutral' | 'reviewed' | 'draft'; title?: string } {
  const intake = row.intake;
  if (!intake || intake.state === 'UNCLASSIFIED') return { label: 'Not sorted', tone: 'neutral' };
  if (intake.state === 'NEEDS_YOU' || intake.state === 'NOT_READ') return { label: 'Needs you', tone: 'draft', ...(intake.question ? { title: intake.question } : {}) };
  const label = (intake.category && labels[intake.category]) ?? intake.category ?? 'Filed';
  const who = intake.source === 'PERSON' ? 'Filed by a person' : `Filed by AI${intake.confidence !== null ? ` (${Math.round(intake.confidence * 100)}% sure)` : ''}`;
  return { label: intake.counterpartyName ? `${label} · ${intake.counterpartyName}` : label, tone: 'reviewed', title: [who, intake.reason].filter(Boolean).join(' — ') };
}

/** Every type the library can filter by, from the shared contract. */
export const LIBRARY_KINDS = Object.keys(DOCUMENT_KINDS);

function aiState(row: LibraryRow, aiOn: boolean): { label: string; tone: 'neutral' | 'reviewed' | 'draft' } {
  if (row.status === 'PURGED') return { label: 'Purged', tone: 'neutral' };
  if (row.aiExcluded) return { label: 'Kept away from AI', tone: 'neutral' };
  if (row.findings > 0) return row.pending > 0 ? { label: `${row.pending} to review`, tone: 'draft' } : { label: 'Reviewed', tone: 'reviewed' };
  return { label: aiOn ? 'No drafts yet' : 'AI off', tone: 'neutral' };
}

/**
 * The deal's document library (T-094 B11): each document with its type,
 * pages, upload date, AI state and finding count; search, filter by type and
 * sort, all in the database a page at a time (T-126); select several on the
 * page to re-run AI extraction. Clicking a name opens it in the page pane.
 */
export function DocumentLibrary({
  dealId,
  rows,
  openId,
  aiOn,
  writer,
  categoryLabels = {},
  total,
  filters,
  params,
}: {
  dealId: string;
  /** This page of the library, already searched, filtered and ordered by the API. */
  rows: readonly LibraryRow[];
  openId?: string;
  aiOn: boolean;
  writer: boolean;
  /** Category id → label for this pact (from intake). */
  categoryLabels?: Readonly<Record<string, string>>;
  /** Documents matching the search and type, across every page. */
  total: number;
  filters: { readonly q: string; readonly kind: string; readonly sort: SortKey; readonly dir: 'asc' | 'desc' };
  /** The page's other URL parameters, kept on every link. */
  params: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(filters.q);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const shown = rows;
  const go = (overrides: Record<string, string | undefined>) => router.push(`/deals/${dealId}/documents?${libraryHref(params, overrides)}`);
  const descending = filters.dir === 'desc';

  const header = (key: SortKey, label: string) => {
    // A new column starts newest or largest first (names A to Z); the same column flips.
    const next = filters.sort === key ? (descending ? 'asc' : 'desc') : key === 'name' ? 'asc' : 'desc';
    return (
      <th scope="col" aria-sort={filters.sort === key ? (descending ? 'descending' : 'ascending') : 'none'} className="px-2 py-2 font-medium">
        <Link href={`/deals/${dealId}/documents?${libraryHref(params, { sort: key, dir: next })}`} className="hover:underline">
          {label}
          {filters.sort === key ? (descending ? ' ↓' : ' ↑') : ''}
        </Link>
      </th>
    );
  };

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

  /** Let the AI sort selected files: earlier uploads, or ones to look at again. A person's answer is kept. */
  const sortSelected = async () => {
    const ids = shown.filter((row) => selected.has(row.id) && row.status === 'AVAILABLE').map((row) => row.id);
    let filed = 0;
    let asked = 0;
    const problems: string[] = [];
    for (const id of ids) {
      setRunning(id);
      const result = await classifyOne(dealId, id).catch(() => ({ kind: 'error' as const, message: 'Pactlab could not sort this file.' }));
      if (result.kind === 'filed') filed += 1;
      else if (result.kind === 'needs-you') asked += 1;
      else problems.push(`${rows.find((row) => row.id === id)?.fileName}: ${result.message}`);
      router.refresh();
    }
    setRunning(null);
    setSelected(new Set());
    setNote(problems.length ? problems.join(' ') : `Sorted ${ids.length} document(s): ${filed} filed, ${asked} waiting for you under “Pactlab needs you”.`);
  };

  const allShownSelected = shown.length > 0 && shown.every((row) => selected.has(row.id));

  return (
    <nav aria-label="Documents" className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: query.trim() || undefined });
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documents (Enter)"
            aria-label="Search documents"
            className="w-56 rounded-md border border-border bg-background px-3 py-1.5"
          />
        </form>
        <select value={filters.kind} onChange={(event) => go({ kind: event.target.value === 'ALL' ? undefined : event.target.value })} aria-label="Filter by type" className="rounded-md border border-border bg-background px-2 py-1.5">
          <option value="ALL">All types</option>
          {LIBRARY_KINDS.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">
          {total} document{total === 1 ? '' : 's'}
          {filters.q || filters.kind !== 'ALL' ? ' matching' : ''}
        </span>
        {writer && aiOn && selected.size > 0 ? (
          <>
            <Button type="button" size="sm" variant="outline" disabled={running !== null} onClick={() => void sortSelected()}>
              {running ? 'Working…' : `Sort with AI (${selected.size})`}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={running !== null} onClick={() => void rerun()}>
              {running ? 'Running AI extraction…' : `Re-run AI extraction on ${selected.size}`}
            </Button>
          </>
        ) : null}
      </div>
      {note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[48rem] border-collapse text-left">
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
                Category
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Type
              </th>
              {header('pages', 'Pages')}
              {header('uploaded', 'Uploaded')}
              <th scope="col" className="px-2 py-2 font-medium">
                AI
              </th>
              <th scope="col" className="px-2 py-2 font-medium">Findings</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const state = aiState(row, aiOn);
              const category = categoryCell(row, categoryLabels);
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
                    {row.source && row.source.state !== 'CURRENT' ? (
                      <span className="ml-2 text-xs text-muted-foreground">{row.source.state === 'REMOVED' ? 'removed from the data room' : 'older version'}</span>
                    ) : null}
                    {row.intake?.sourcePath ? <span className="block text-xs text-muted-foreground">{row.intake.sourcePath}</span> : null}
                    {(() => {
                      // T-121: reading the document's images, said plainly; a failure offers Read again.
                      const line = visionLine(row.vision);
                      if (!line) return null;
                      return (
                        <span className="block text-xs text-muted-foreground" role="status">
                          {line.text}
                          {line.retry ? (
                            <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={() => void readImagesAgain(dealId, row.id).then(() => router.refresh())}>
                              Read again
                            </Button>
                          ) : null}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={category.tone} title={category.title}>
                      {category.label}
                    </Badge>
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
