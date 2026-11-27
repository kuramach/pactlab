// T-178e: the `pactlab-rinse-releases` v1 feed that pactlab.ai/rinse reads (apps/site/lib/rinse.ts),
// built from the rinse-desktop workflow's artifacts: one installer per platform, its SHA-256 from the
// build's SHA256SUMS.txt, and `signed` exactly as the build's SIGNING.json records it. Nothing is
// invented: a platform whose build is missing is left out, and an asset is `signed: true` only when its
// build was code-signed.
// Usage: node scripts/release-feed.mjs <artifacts-dir> <version> <download-base-url> [note…] > releases.json
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Which installer the download page offers per build target. */
export const PLATFORMS = {
  'aarch64-apple-darwin': { platform: 'macos-arm64', installer: /\.dmg$/, minimumOs: 'macOS 12' },
  'x86_64-apple-darwin': { platform: 'macos-x64', installer: /\.dmg$/, minimumOs: 'macOS 12' },
  'x86_64-pc-windows-msvc': { platform: 'windows-x64', installer: /-setup\.exe$/, minimumOs: null },
  'x86_64-unknown-linux-gnu': { platform: 'linux-x64', installer: /\.AppImage$/, minimumOs: null },
};

/** The name an installer is published under: GitHub release assets cannot hold spaces. */
export const releaseName = (name) => name.replace(/\s+/g, '-');

/** `<sha256>  <path>` lines, as `shasum -a 256` writes them. */
export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (match) sums.set(basename(match[2]), match[1]);
  }
  return sums;
}

/**
 * builds: [{ target, signing, sums, files: [{ name, sizeBytes }] }] → the feed.
 * Throws when a build's installer has no checksum: a download without one is never published.
 */
export function buildFeed({ builds, version, baseUrl, publishedAt, notes }) {
  if (!baseUrl.startsWith('https://')) throw new Error('installer links must be https');
  const assets = [];
  for (const build of builds) {
    const spec = PLATFORMS[build.target];
    if (!spec) continue;
    const file = build.files.find((entry) => spec.installer.test(entry.name));
    if (!file) continue;
    const sha256 = build.sums.get(file.name);
    if (!sha256) throw new Error(`${file.name} has no SHA-256 in its build's SHA256SUMS.txt`);
    assets.push({
      platform: spec.platform,
      url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(releaseName(file.name))}`,
      sha256,
      sizeBytes: file.sizeBytes,
      signed: build.signing.codeSigned === true,
      ...(spec.minimumOs ? { minimumOs: spec.minimumOs } : {}),
    });
  }
  if (assets.length === 0) throw new Error('no installers to publish');
  return { schema: 'pactlab-rinse-releases', version: 1, releases: [{ version, publishedAt, notes, assets }] };
}

/** Each artifact folder as the workflow downloads it: pactlab-rinse-<target>/… */
export function readBuilds(dir) {
  return readdirSync(dir)
    .filter((name) => name.startsWith('pactlab-rinse-'))
    .map((name) => {
      const folder = join(dir, name);
      const files = [];
      const walk = (at) => {
        for (const entry of readdirSync(at)) {
          const path = join(at, entry);
          if (statSync(path).isDirectory()) walk(path);
          else files.push({ name: entry, path, sizeBytes: statSync(path).size });
        }
      };
      walk(folder);
      const read = (file) => readFileSync(files.find((entry) => entry.name === file)?.path ?? join(folder, file), 'utf8');
      return { target: name.slice('pactlab-rinse-'.length), signing: JSON.parse(read('SIGNING.json')), sums: parseSums(read('SHA256SUMS.txt')), files };
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, version, baseUrl, ...notes] = process.argv.slice(2);
  if (!dir || !version || !baseUrl) throw new Error('Usage: release-feed.mjs <artifacts-dir> <version> <download-base-url> [note…]');
  const builds = readBuilds(dir);
  // The publish step uploads each installer under its release name; print them for it.
  if (process.env['RINSE_LIST_INSTALLERS']) {
    for (const build of builds) {
      const spec = PLATFORMS[build.target];
      const file = spec && build.files.find((entry) => spec.installer.test(entry.name));
      if (file) process.stdout.write(`${file.path}\t${releaseName(file.name)}\n`);
    }
    process.exit(0);
  }
  const feed = buildFeed({ builds, version, baseUrl, publishedAt: new Date().toISOString(), notes });
  process.stdout.write(`${JSON.stringify(feed, null, 2)}\n`);
}
