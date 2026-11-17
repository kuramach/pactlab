/**
 * The home hero's background montage (T-130): pre-built, served as-is (never re-encoded larger).
 * Six scenes of where deals live, about 4 s each, a 25 s silent loop; no text, logos or claims.
 */
export const HERO_ASSETS = {
  desktop: { path: '/hero/hero-loop.mp4', bytes: 3_346_267, sha256: '849f4bfd0f87f4f4f3c16858973856686025b0572bed65d17d8f8724124e9602' },
  mobile: { path: '/hero/hero-loop-mobile.mp4', bytes: 1_077_345, sha256: '578879f2fd780cb72c8b9c132829205e1c28a754d0f3cebaed514802427f9179' },
  poster: { path: '/hero/hero-poster.jpg', bytes: 188_342, sha256: 'a34c5a7eb1adf51f02012ef773b4374ba7463e5ceebd41f29957194ab26e49d5' },
} as const;

/** Below this width the mobile file is served, and the desktop one is never fetched. */
export const HERO_MOBILE_QUERY = '(max-width: 767px)';
