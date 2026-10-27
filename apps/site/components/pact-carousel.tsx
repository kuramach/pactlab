'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PactCard } from '../lib/content';

const INTERVAL_MS = 5000;

/**
 * "Pacts you can run" (T-086): a scroll-snap row of pact cards. Advances one
 * card every 5 s while on screen; pauses on hover or focus, stops after any
 * manual step, swipe or scroll until the visitor leaves the section, and
 * never auto-advances for users who prefer reduced motion. Swipe and scroll
 * are the browser's own, so the page never gets trapped. Without
 * JavaScript the row still scrolls.
 */
export function PactCarousel({ cards }: { cards: readonly PactCard[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  const count = cards.length;

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const element = track.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.5 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scrollTo = useCallback(
    (next: number) => {
      const element = track.current;
      const wrapped = ((next % count) + count) % count;
      const card = element?.children[wrapped] as HTMLElement | undefined;
      if (!element || !card) return;
      // The track is the cards' offset parent; scroll padding keeps the gutter.
      const gutter = Number.parseFloat(getComputedStyle(element).scrollPaddingLeft) || 0;
      element.scrollTo({ left: card.offsetLeft - gutter, behavior: reduced ? 'auto' : 'smooth' });
      setIndex(wrapped);
    },
    [count, reduced],
  );

  // Keep the dots in step with swipes and scrolls.
  const onScroll = useCallback(() => {
    const element = track.current;
    if (!element) return;
    const cardWidth = (element.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
    const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
    setIndex(atEnd ? count - 1 : Math.round(element.scrollLeft / cardWidth));
  }, [count]);

  useEffect(() => {
    if (reduced || held || stopped || !visible || count < 2) return;
    const timer = window.setTimeout(() => {
      const element = track.current;
      const atEnd = element ? element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 : false;
      scrollTo(atEnd ? 0 : index + 1);
    }, INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [reduced, held, stopped, visible, index, count, scrollTo]);

  const step = (next: number) => {
    setStopped(true);
    scrollTo(next);
  };

  return (
    <section
      aria-labelledby="pacts-title"
      className="bg-white"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => {
        setHeld(false);
        setStopped(false);
      }}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setHeld(false);
        setStopped(false);
      }}
    >
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-ink">Every pact has two sides</p>
            <h2 id="pacts-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Pacts you can run
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(index - 1)}
              aria-label="Previous pact"
              className="rounded-full border border-navy/20 p-2 hover:border-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-ink"
            >
              <ChevronLeft aria-hidden className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => step(index + 1)}
              aria-label="Next pact"
              className="rounded-full border border-navy/20 p-2 hover:border-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-ink"
            >
              <ChevronRight aria-hidden className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div aria-roledescription="carousel" aria-label="Pacts you can run" className="mt-8">
          <div
            ref={track}
            aria-live="off"
            onScroll={onScroll}
            onPointerDown={() => setStopped(true)}
            onWheel={(event) => {
              if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) setStopped(true);
            }}
            className="relative -mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-6 px-6 pb-4 sm:mx-0 sm:scroll-px-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {cards.map((card, position) => (
              <div
                key={card.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${position + 1} of ${count}: ${card.name}`}
                className="w-[82%] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)]"
              >
                <Link
                  href={card.href}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-navy/10 bg-mist hover:border-indigo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-ink"
                >
                  <img
                    src={card.image}
                    alt=""
                    width={640}
                    height={420}
                    loading={position === 0 ? 'eager' : 'lazy'}
                    className="aspect-[640/420] h-auto w-full bg-white object-cover"
                  />
                  <span className="flex flex-1 flex-col gap-2 p-5">
                    <span className="text-lg font-bold">{card.name}</span>
                    <span className="text-sm leading-relaxed text-slate-text">{card.line}</span>
                    <span className="mt-auto pt-2 text-sm font-semibold text-indigo-ink group-hover:underline">Explore →</span>
                  </span>
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap justify-center" role="group" aria-label="Choose a pact">
            {cards.map((card, position) => (
              <button
                key={card.id}
                type="button"
                onClick={() => step(position)}
                aria-label={card.name}
                aria-current={position === index ? 'true' : undefined}
                className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-ink"
              >
                <span aria-hidden className={`block h-2 rounded-full transition-all ${position === index ? 'w-5 bg-indigo-ink' : 'w-2 bg-navy/20'}`} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
