'use client';

import { useEffect, useRef, useState } from 'react';
import { quoteSpans } from './quote-spans';

type Box = { left: number; top: number; width: number; height: number };

/**
 * One page of the stored PDF, drawn as the reader sees it, with each cited
 * quote highlighted on the page. Read-only: fonts, scripts, forms and links
 * in the file are not run. The file comes through this app's own route (the
 * API checks access and audits the read).
 */
export function PdfPageView({ src, pageNumber, quotes, fileName }: { src: string; pageNumber: number; quotes: readonly string[]; fileName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [missing, setMissing] = useState(0);
  const quoteKey = quotes.join('\u0000');

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    (async () => {
      setState('loading');
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const task = pdfjs.getDocument({ url: src, enableXfa: false, disableAutoFetch: true });
      destroy = () => task.destroy();
      const pdf = await task.promise;
      const page = await pdf.getPage(Math.min(Math.max(pageNumber, 1), pdf.numPages));
      const base = page.getViewport({ scale: 1 });
      const width = Math.min(860, canvas.current?.parentElement?.clientWidth ?? 860);
      const viewport = page.getViewport({ scale: width / base.width });
      const target = canvas.current;
      if (!target || cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      await page.render({ canvas: target, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;

      // Highlight: the text items each quote covers, boxed in page coordinates.
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is (typeof content.items)[number] & { str: string; transform: number[]; width: number; height: number } => 'str' in item);
      const found: Box[] = [];
      let notFound = 0;
      for (const quote of quotes) {
        const spans = quoteSpans(items.map((item) => item.str), quote);
        if (spans.length === 0) notFound += 1;
        for (const index of spans) {
          const item = items[index];
          if (!item) continue;
          const [x, y] = viewport.convertToViewportPoint(item.transform[4] ?? 0, item.transform[5] ?? 0);
          const height = Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) * viewport.scale;
          found.push({ left: x ?? 0, top: (y ?? 0) - height, width: item.width * viewport.scale, height: height * 1.2 });
        }
      }
      if (cancelled) return;
      setBoxes(found);
      setMissing(notFound);
      setSize({ width: viewport.width, height: viewport.height });
      setState('ready');
    })().catch(() => {
      if (!cancelled) setState('error');
    });
    return () => {
      cancelled = true;
      void destroy?.();
    };
    // quoteKey stands for `quotes` (a new array each render), so effects rerun only when quotes change.
  }, [src, pageNumber, quoteKey]);

  return (
    <figure className="flex flex-col gap-2" aria-label={`${fileName}, page ${pageNumber}, as the original PDF`}>
      <div className="relative overflow-hidden rounded-lg border border-border bg-white" style={size ? { width: size.width, height: size.height } : undefined}>
        <canvas ref={canvas} role="img" aria-label={`Page ${pageNumber} of ${fileName}`} />
        {boxes.map((box, index) => (
          <mark
            key={index}
            data-testid="pdf-highlight"
            className="pointer-events-none absolute rounded-sm bg-amber-300/40 ring-1 ring-amber-500/60"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
        ))}
        {state === 'loading' ? <p className="p-6 text-sm text-muted-foreground">Loading the original page…</p> : null}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {state === 'error'
          ? 'The original PDF could not be shown here. The extracted text below is what citations are checked against.'
          : missing > 0
            ? `${missing} cited quote${missing === 1 ? '' : 's'} could not be placed on the drawn page; the extracted text below shows ${missing === 1 ? 'it' : 'them'}.`
            : 'Original page with cited quotes highlighted.'}
      </figcaption>
    </figure>
  );
}
