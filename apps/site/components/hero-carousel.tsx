'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Slide } from '../lib/content';

const INTERVAL_MS = 8000;

/**
 * Home page hero carousel. Rotates every 8 s, pauses on hover, keyboard
 * focus or the pause button, and never auto-rotates for users who prefer
 * reduced motion (WCAG 2.2.2). Without JavaScript the first slide shows.
 */
export function HeroCarousel({ slides, cta }: { slides: readonly Slide[]; cta: { href: string; label: string } | null }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const count = slides.length;
  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing || held || count < 2) return;
    const timer = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, held, index, count, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Why Pactlab"
      className="relative overflow-hidden bg-navy text-white"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(index + 1);
        if (event.key === 'ArrowLeft') go(index - 1);
      }}
    >
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-indigo/20 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6 pb-10 pt-14 md:pt-20">
        <div aria-live={playing && !held ? 'off' : 'polite'}>
          {slides.map((slide, position) => {
            const active = position === index;
            return (
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${position + 1} of ${count}: ${slide.eyebrow}`}
                aria-hidden={!active}
                inert={!active}
                className={`grid items-center gap-12 md:grid-cols-[1.15fr_1fr] ${active ? 'animate-[fade_600ms_ease-out]' : 'hidden'}`}
              >
                <div className="flex flex-col gap-6">
                  <p className="text-sm font-bold uppercase tracking-widest text-indigo">{slide.eyebrow}</p>
                  {position === 0 ? (
                    <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">{slide.title}</h1>
                  ) : (
                    <h2 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">{slide.title}</h2>
                  )}
                  <p className="max-w-xl text-lg leading-relaxed text-white/85">{slide.body}</p>
                  <ul className="flex flex-col gap-2 text-white/90">
                    {slide.points.map((point) => (
                      <li key={point} className="flex items-center gap-3">
                        <span aria-hidden className="h-2 w-2 rounded-full bg-indigo" />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    {cta ? (
                      <a href={cta.href} className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-white">
                        {cta.label}
                      </a>
                    ) : null}
                    <Link href={slide.link.href} className="font-semibold text-white underline-offset-4 hover:underline">
                      {slide.link.label} →
                    </Link>
                  </div>
                </div>
                <div className="rounded-3xl bg-white p-3 shadow-2xl shadow-black/30">
                  <img src={slide.image} alt={slide.imageAlt} width={640} height={420} className="h-auto w-full rounded-2xl" />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a slide">
            {slides.map((slide, position) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => go(position)}
                aria-current={position === index ? 'true' : undefined}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  position === index ? 'bg-indigo text-navy' : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {slide.eyebrow}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => go(index - 1)} aria-label="Previous slide" className="rounded-full border border-white/25 p-2 hover:border-white">
              <ChevronLeft aria-hidden className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((value) => !value)}
              aria-label={playing ? 'Pause rotation' : 'Play rotation'}
              className="rounded-full border border-white/25 p-2 hover:border-white"
            >
              {playing ? <Pause aria-hidden className="h-5 w-5" /> : <Play aria-hidden className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => go(index + 1)} aria-label="Next slide" className="rounded-full border border-white/25 p-2 hover:border-white">
              <ChevronRight aria-hidden className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
