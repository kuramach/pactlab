import { z } from 'zod';

/**
 * The Pactlab Rinse release feed (T-178c). The release pipeline (T-178b,
 * ADR 0059) publishes it; the download page reads it at build time. Nothing
 * here invents a release: with no feed, or a feed that fails its schema, the
 * page says the installers are not published yet.
 */
export const RINSE_PLATFORMS = ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'] as const;
export type RinsePlatform = (typeof RINSE_PLATFORMS)[number];

const asset = z.strictObject({
  platform: z.enum(RINSE_PLATFORMS),
  /** An https address: an installer is never offered over a plain link. */
  url: z.url().refine((value) => value.startsWith('https://'), 'installer links must be https'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a lower-case SHA-256 hex digest'),
  sizeBytes: z.number().int().positive().optional(),
  /** False for a build without a signing identity: the page says so. */
  signed: z.boolean(),
  /** The oldest operating-system version this build runs on, as the release states it. */
  minimumOs: z.string().min(1).optional(),
});

const release = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'a semantic version'),
  publishedAt: z.iso.datetime(),
  /** Plain English lines, one change each. */
  notes: z.array(z.string().min(1)).max(50),
  assets: z.array(asset).min(1),
});

export const releaseFeedSchema = z.strictObject({
  schema: z.literal('pactlab-rinse-releases'),
  version: z.literal(1),
  releases: z.array(release),
});

export type RinseRelease = z.infer<typeof release>;
export type RinseAsset = z.infer<typeof asset>;

const compare = (a: string, b: string): number => {
  const parts = (value: string) => (value.split(/[-+]/)[0] ?? '').split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) if (x[index] !== y[index]) return (x[index] ?? 0) - (y[index] ?? 0);
  return 0;
};

/** The releases the feed lists, newest first; null when the feed is absent or does not parse. */
export function parseReleaseFeed(raw: unknown): readonly RinseRelease[] | null {
  const parsed = releaseFeedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const releases = parsed.data.releases.filter((entry, index, all) => all.findIndex((other) => other.version === entry.version) === index);
  return releases.sort((a, b) => compare(b.version, a.version));
}

/** Read the feed at `url` (build time). Any failure is an empty list: the page shows its "not published yet" state. */
export async function loadRinseReleases(url: string | undefined = process.env['RINSE_RELEASES_URL'], fetcher: typeof fetch = fetch): Promise<readonly RinseRelease[]> {
  if (!url?.trim()) return [];
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return [];
    return parseReleaseFeed(await response.json()) ?? [];
  } catch {
    return [];
  }
}

/** One asset per platform from the newest release that has one, so a platform missing from the latest build still offers its last installer. */
export function latestByPlatform(releases: readonly RinseRelease[]): Readonly<Partial<Record<RinsePlatform, { release: RinseRelease; asset: RinseAsset }>>> {
  const out: Partial<Record<RinsePlatform, { release: RinseRelease; asset: RinseAsset }>> = {};
  for (const entry of releases) {
    for (const item of entry.assets) out[item.platform] ??= { release: entry, asset: item };
  }
  return out;
}

export const formatMegabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
