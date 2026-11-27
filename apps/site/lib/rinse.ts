import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * The Pactlab Rinse release feed (T-178c, ADR 0058): what the download page
 * at /rinse reads. The release pipeline (T-178b) publishes it next to the
 * installers; this file is the contract the page holds it to. Everything in
 * it is untrusted input: links must be https, checksums must be SHA-256, and
 * notes are rendered as plain text.
 */
export const RINSE_PLATFORMS = ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'] as const;
export type RinsePlatform = (typeof RINSE_PLATFORMS)[number];

const installerSchema = z.strictObject({
  platform: z.enum(RINSE_PLATFORMS),
  url: z.url({ protocol: /^https$/ }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex SHA-256'),
  bytes: z.number().int().positive().optional(),
});

const releaseSchema = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'a semantic version'),
  publishedAt: z.iso.datetime(),
  notes: z.array(z.string().min(1).max(500)).max(30),
  installers: z.array(installerSchema).min(1),
});

export const rinseFeedSchema = z.strictObject({
  schema: z.literal('pactlab-rinse-releases'),
  version: z.literal(1),
  /** Newest first. The first entry is the current release. */
  releases: z.array(releaseSchema),
});

export type RinseInstaller = z.infer<typeof installerSchema>;
export type RinseRelease = z.infer<typeof releaseSchema>;

/** Throws on a feed that does not fit the contract: a malformed feed must stop the build, not publish a wrong download. */
export function parseRinseFeed(input: unknown): RinseRelease | null {
  const feed = rinseFeedSchema.parse(input);
  for (const release of feed.releases) {
    const platforms = release.installers.map((installer) => installer.platform);
    if (new Set(platforms).size !== platforms.length) throw new Error(`Rinse release ${release.version} lists a platform twice`);
  }
  return feed.releases[0] ?? null;
}

/**
 * The current release, read at build time from `RINSE_RELEASE_FEED_URL`
 * (https; `file:` only for local and end-to-end builds). Null when the feed
 * is not configured or has no release yet: the page then says installers are
 * not published, and never links a placeholder. A configured feed that cannot
 * be read or does not parse fails the build.
 */
export async function currentRinseRelease(source: Record<string, string | undefined> = process.env): Promise<RinseRelease | null> {
  const url = source['RINSE_RELEASE_FEED_URL']?.trim();
  if (!url) return null;
  const location = new URL(url);
  let body: string;
  if (location.protocol === 'file:') body = await readFile(fileURLToPath(location), 'utf8');
  else if (location.protocol === 'https:') {
    const response = await fetch(location);
    if (!response.ok) throw new Error(`Rinse release feed answered ${response.status}`);
    body = await response.text();
  } else throw new Error('RINSE_RELEASE_FEED_URL must be https or file');
  return parseRinseFeed(JSON.parse(body));
}

/** Installers in the order the page lists them, whichever order the feed used. */
export const installersInOrder = (release: RinseRelease): RinseInstaller[] =>
  RINSE_PLATFORMS.flatMap((platform) => release.installers.filter((installer) => installer.platform === platform));
