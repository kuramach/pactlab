import { describe, expect, it } from 'vitest';
import { latestByPlatform, loadRinseReleases, parseReleaseFeed } from './rinse';

const sha = 'a'.repeat(64);
const asset = (platform: string, extra: object = {}) => ({ platform, url: `https://downloads.example.test/${platform}`, sha256: sha, signed: true, ...extra });
const release = (version: string, platforms: string[]) => ({ version, publishedAt: '2027-01-20T10:00:00.000Z', notes: ['Fixed a thing.'], assets: platforms.map((platform) => asset(platform)) });
const feed = (releases: object[]) => ({ schema: 'pactlab-rinse-releases', version: 1, releases });

describe('Rinse release feed (T-178c)', () => {
  it('orders releases newest first and keeps the first of a repeated version', () => {
    const parsed = parseReleaseFeed(feed([release('0.9.0', ['linux-x64']), release('0.10.0', ['linux-x64']), release('0.10.0', ['windows-x64'])]));
    expect(parsed?.map((entry) => entry.version)).toEqual(['0.10.0', '0.9.0']);
    expect(parsed?.[0]?.assets[0]?.platform).toBe('linux-x64');
  });

  it('refuses a feed that is not the schema: bad digest, plain-http link, unknown field, wrong version', () => {
    expect(parseReleaseFeed(feed([{ ...release('1.0.0', ['linux-x64']), assets: [asset('linux-x64', { sha256: 'abc' })] }]))).toBeNull();
    expect(parseReleaseFeed(feed([{ ...release('1.0.0', ['linux-x64']), assets: [asset('linux-x64', { url: 'http://example.test/x' })] }]))).toBeNull();
    expect(parseReleaseFeed(feed([{ ...release('1.0.0', ['linux-x64']), extra: 1 }]))).toBeNull();
    expect(parseReleaseFeed({ ...feed([]), version: 2 })).toBeNull();
    expect(parseReleaseFeed(null)).toBeNull();
    expect(parseReleaseFeed(feed([]))).toEqual([]);
  });

  it('offers each platform its newest installer, falling back to an older release', () => {
    const latest = latestByPlatform(parseReleaseFeed(feed([release('1.1.0', ['macos-arm64', 'windows-x64']), release('1.0.0', ['macos-arm64', 'macos-x64', 'linux-x64'])]))!);
    expect(latest['macos-arm64']?.release.version).toBe('1.1.0');
    expect(latest['linux-x64']?.release.version).toBe('1.0.0');
    expect(Object.keys(latest).sort()).toEqual(['linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64']);
  });

  it('reads nothing without a feed address and nothing from a failing or malformed feed', async () => {
    expect(await loadRinseReleases('')).toEqual([]);
    expect(await loadRinseReleases('https://feed.test/', async () => new Response('nope', { status: 500 }))).toEqual([]);
    expect(await loadRinseReleases('https://feed.test/', async () => new Response('{"x":1}'))).toEqual([]);
    expect(await loadRinseReleases('https://feed.test/', async () => Promise.reject(new Error('offline')))).toEqual([]);
    const ok = await loadRinseReleases('https://feed.test/', async () => new Response(JSON.stringify(feed([release('1.0.0', ['linux-x64'])]))));
    expect(ok).toHaveLength(1);
  });
});
