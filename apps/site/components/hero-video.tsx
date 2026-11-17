'use client';

import { useEffect, useRef, useState } from 'react';
import { HERO_ASSETS, HERO_MOBILE_QUERY } from '../lib/hero';

const HERO_POSTER = HERO_ASSETS.poster.path;

/**
 * The home hero's ambient background (T-130): a silent 25-second montage of the places deals
 * live (a campus, a business lunch, a hospital, a plant, a coal mine and an oil rig), behind
 * the existing hero copy. Scenes only, no text, logos or claims.
 * - The poster is a plain image that paints first (the hero's LCP); the video is chosen and
 *   loaded after hydration, so it never blocks the first paint, and fades in once it can play.
 * - Reduced motion: the poster only, nothing autoplays. Blocked or failed video: the poster stays.
 * - A navy overlay keeps the hero text at WCAG AA contrast over every scene.
 */
export function HeroVideo() {
  const [source, setSource] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setSource(window.matchMedia(HERO_MOBILE_QUERY).matches ? HERO_ASSETS.mobile.path : HERO_ASSETS.desktop.path);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || !source) return;
    // Autoplay can still be refused (data saver, a browser policy): the poster then simply stays.
    void element.play().catch(() => setReady(false));
  }, [source]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <img src={HERO_POSTER} alt="" width={1280} height={720} fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      {source ? (
        <video
          ref={video}
          src={source}
          poster={HERO_POSTER}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          onPlaying={() => setReady(true)}
          onError={() => setReady(false)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}
          data-testid="hero-video"
        />
      ) : null}
      {/* Brand navy (#081127) over the footage: darkest behind the copy on the left, so white text keeps AA contrast on the brightest scene. */}
      <div className="absolute inset-0 bg-gradient-to-r from-navy/95 via-navy/85 to-navy/70" />
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-navy/40" />
    </div>
  );
}
