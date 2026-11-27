'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Slide } from '../lib/content';
import { fill } from '../lib/i18n/localize';
import type { Messages } from '../messages/en/ui';
import { HeroVideo } from './hero-video';
import { Icon } from './icon';
import { viewerCountry, withCountry } from './pilot-request';

const INTERVAL_MS = 6000;


/**
 * Home page hero carousel: platform messages and runnable pacts, with the
 * buttons grouped by kind. Rotates every 6 s, pauses while the pointer is on the copy or controls, keyboard
 * focus or the pause button, and never auto-rotates for users who prefer
 * reduced motion (WCAG 2.2.2). Without JavaScript the first slide shows.
 */
export function HeroCarousel({
  slides,
  cta,
  allPacts,
  positioning,
  words,
}: {
  /** Slide links are already in the page's language. */
  slides: readonly Slide[];
  /** The pilot request, with the visitor's country pre-filled when the edge saw it. */
  cta: { href: string; label: string; countryLabel: string; language: string } | null;
  /** Ends the pact buttons: the slider features a few pacts, this link reaches the rest. */
  allPacts?: { href: string; label: string };
  /** Who it is for and what it does (T-120): fixed above the slides, so the first screen always says it. */
  positioning?: { eyebrow: string; line: string };
  words: Messages['carousel'];
}) {
  const groups = [
    { group: 'platform', label: words.platform },
    { group: 'pact', label: words.pacts },
  ] as const;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  // The first slide shows at once (no fade), so it paints as early as possible (LCP); later slides fade in.
  const [moved, setMoved] = useState(false);
  const count = slides.length;
  const [ctaHref, setCtaHref] = useState(cta?.href ?? '');
  useEffect(() => {
    if (cta) setCtaHref(withCountry(cta.href, viewerCountry(document.cookie), { label: cta.countryLabel, language: cta.language }));
  }, [cta]);
  const go = useCallback(
    (next: number) => {
      setMoved(true);
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing || held || count < 2) return;
    const timer = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, held, index, count, go]);

  // Hover holds the rotation only over what someone is reading or using (the copy and the slide
  // controls), never over the background video, which would leave the slides looking frozen (T-130).
  // Keyboard focus and the pause button still stop it (WCAG 2.2.2).
  const hold = { onMouseEnter: () => setHeld(true), onMouseLeave: () => setHeld(false) };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={words.label}
      className="relative overflow-hidden bg-navy text-white"
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(index + 1);
        if (event.key === 'ArrowLeft') go(index - 1);
      }}
    >
      {/* T-130: the ambient montage behind the hero; the copy and controls above are unchanged. */}
      <HeroVideo />
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-indigo/20 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6 pb-10 pt-14 md:pt-20">
        {positioning ? (
          <div {...hold} className="mb-8 flex max-w-3xl flex-col gap-2 border-b border-white/10 pb-6 [text-shadow:0_1px_14px_rgba(8,17,39,0.75)]">
            <p className="text-xs font-bold uppercase tracking-widest text-indigo">{positioning.eyebrow}</p>
            <p className="text-lg font-semibold leading-snug text-white/90 md:text-xl">{positioning.line}</p>
          </div>
        ) : null}
        <div aria-live={playing && !held ? 'off' : 'polite'}>
          {slides.map((slide, position) => {
            const active = position === index;
            return (
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={fill(words.position, { position: position + 1, count, eyebrow: slide.eyebrow })}
                aria-hidden={!active}
                inert={!active}
                className={`grid items-center gap-12 md:grid-cols-[1.15fr_1fr] ${active ? (moved ? 'animate-[fade_600ms_ease-out]' : '') : 'hidden'}`}
              >
                {/* T-130: a soft navy shadow keeps the copy crisp over bright moments in the footage (copy column only, not the card). */}
                <div {...hold} className="flex flex-col gap-6 [text-shadow:0_1px_14px_rgba(8,17,39,0.75)]">
                  {slide.group === 'pact' ? (
                    <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-indigo">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo px-3 py-1 text-xs text-navy">
                        {slide.icon ? <Icon name={slide.icon} className="h-4 w-4" /> : null}
                        {words.pactTag}
                      </span>
                      {slide.eyebrow}
                    </p>
                  ) : (
                    <p className="text-sm font-bold uppercase tracking-widest text-indigo">{slide.eyebrow}</p>
                  )}
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
                      <a href={ctaHref} className="inline-flex items-center rounded-lg bg-indigo px-5 py-3 font-bold text-navy hover:bg-white">
                        {cta.label}
                      </a>
                    ) : null}
                    <Link href={slide.link.href} className="font-semibold text-white underline-offset-4 hover:underline">
                      {slide.link.label} →
                    </Link>
                  </div>
                </div>
                <div className="rounded-3xl bg-white p-3 shadow-2xl shadow-black/30">
                  <img src={slide.image} alt={slide.imageAlt} width={640} height={420} className="aspect-[640/420] h-auto w-full object-cover rounded-2xl" />
                </div>
              </div>
            );
          })}
        </div>

        <div {...hold} className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            {groups.map(({ group, label }) => {
              const members = slides.map((slide, position) => ({ slide, position })).filter(({ slide }) => slide.group === group);
              if (members.length === 0) return null;
              return (
                <div key={group} role="group" aria-label={label} className="flex flex-col gap-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-white/50">{label}</p>
                  <div className="flex flex-wrap gap-2">
                    {members.map(({ slide, position }) => (
                      <button
                        key={slide.id}
                        type="button"
                        onClick={() => go(position)}
                        aria-current={position === index ? 'true' : undefined}
                        aria-label={slide.eyebrow}
                        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                          position === index ? 'bg-indigo text-navy' : 'bg-white/10 text-white/80 hover:bg-white/20'
                        }`}
                      >
                        {slide.icon ? <Icon name={slide.icon} className="h-4 w-4" /> : null}
                        {slide.short}
                      </button>
                    ))}
                    {group === 'pact' && allPacts ? (
                      <Link href={allPacts.href} className="inline-flex items-center px-2 py-2 text-sm font-semibold text-white underline-offset-4 hover:underline">
                        {allPacts.label} →
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => go(index - 1)} aria-label={words.previous} className="rounded-full border border-white/25 p-2 hover:border-white">
              <ChevronLeft aria-hidden className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((value) => !value)}
              aria-label={playing ? words.pause : words.play}
              className="rounded-full border border-white/25 p-2 hover:border-white"
            >
              {playing ? <Pause aria-hidden className="h-5 w-5" /> : <Play aria-hidden className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => go(index + 1)} aria-label={words.next} className="rounded-full border border-white/25 p-2 hover:border-white">
              <ChevronRight aria-hidden className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
