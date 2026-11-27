import { describe, expect, it } from 'vitest';
import { currentRinseRelease, installersInOrder, parseRinseFeed } from './rinse';

const fixture = new URL('../e2e/fixtures/rinse-releases.json', import.meta.url).toString();
const feed = (release: object) => ({ schema: 'pactlab-rinse-releases', version: 1, releases: [release] });
const installer = { platform: 'linux-x64', url: 'https://downloads.example.test/a.AppImage', sha256: 'a'.repeat(64) };
const release = { version: '1.2.3', publishedAt: '2026-12-01T09:00:00.000Z', notes: ['Note'], installers: [installer] };

describe('Rinse release feed (T-178c)', () => {
  it('reads the current release, with every platform in page order', async () => {
    const current = await currentRinseRelease({ RINSE_RELEASE_FEED_URL: fixture });
    expect(current?.version).toBe('0.1.0');
    expect(installersInOrder(current!).map((entry) => entry.platform)).toEqual(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']);
  });

  it('has no release when the feed is unset or empty', async () => {
    expect(await currentRinseRelease({})).toBeNull();
    expect(parseRinseFeed({ schema: 'pactlab-rinse-releases', version: 1, releases: [] })).toBeNull();
  });

  it('refuses a feed that does not fit, rather than publishing a wrong download', () => {
    expect(parseRinseFeed(feed(release))?.version).toBe('1.2.3');
    expect(() => parseRinseFeed(feed({ ...release, installers: [{ ...installer, url: 'http://downloads.example.test/a' }] }))).toThrow();
    expect(() => parseRinseFeed(feed({ ...release, installers: [{ ...installer, url: 'javascript:alert(1)' }] }))).toThrow();
    expect(() => parseRinseFeed(feed({ ...release, installers: [{ ...installer, sha256: 'ABC' }] }))).toThrow();
    expect(() => parseRinseFeed(feed({ ...release, installers: [{ ...installer, platform: 'freebsd' }] }))).toThrow();
    expect(() => parseRinseFeed(feed({ ...release, version: 'latest' }))).toThrow();
    expect(() => parseRinseFeed(feed({ ...release, extra: true }))).toThrow();
    expect(() => parseRinseFeed(feed({ ...release, installers: [installer, installer] }))).toThrow('twice');
  });

  it('refuses a feed address that is not https or file', async () => {
    await expect(currentRinseRelease({ RINSE_RELEASE_FEED_URL: 'http://example.test/feed.json' })).rejects.toThrow('https or file');
  });
});
