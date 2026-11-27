import { describe, expect, it } from 'vitest';
import { buildFeed, parseSums } from '../../scripts/release-feed.mjs';

const sha = (c: string) => c.repeat(64);
const build = (target: string, name: string, codeSigned: boolean, digest = sha('a')) => ({ target, signing: { codeSigned }, sums: parseSums(`${digest}  apps/desktop/src-tauri/target/${target}/release/bundle/x/${name}\n`), files: [{ name, sizeBytes: 1234 }, { name: 'SIGNING.json', sizeBytes: 10 }] });

describe('the release feed the download page reads (T-178e)', () => {
  it('lists one installer per platform with its build’s checksum, marked unsigned unless code-signed', () => {
    const feed = buildFeed({
      builds: [build('aarch64-apple-darwin', 'Pactlab Rinse_0.1.0_aarch64.dmg', false), build('x86_64-pc-windows-msvc', 'Pactlab Rinse_0.1.0_x64-setup.exe', false, sha('b')), build('x86_64-unknown-linux-gnu', 'pactlab-rinse_0.1.0_amd64.AppImage', true, sha('c'))],
      version: '0.1.0',
      baseUrl: 'https://github.com/kuramach/pactlab/releases/download/rinse-v0.1.0/',
      publishedAt: '2026-11-27T12:00:00.000Z',
      notes: ['First release, unsigned.'],
    });
    expect(feed).toMatchObject({ schema: 'pactlab-rinse-releases', version: 1, releases: [{ version: '0.1.0', notes: ['First release, unsigned.'] }] });
    expect(feed.releases[0]?.assets).toEqual([
      { platform: 'macos-arm64', url: 'https://github.com/kuramach/pactlab/releases/download/rinse-v0.1.0/Pactlab-Rinse_0.1.0_aarch64.dmg', sha256: sha('a'), sizeBytes: 1234, signed: false, minimumOs: 'macOS 12' },
      { platform: 'windows-x64', url: 'https://github.com/kuramach/pactlab/releases/download/rinse-v0.1.0/Pactlab-Rinse_0.1.0_x64-setup.exe', sha256: sha('b'), sizeBytes: 1234, signed: false },
      { platform: 'linux-x64', url: 'https://github.com/kuramach/pactlab/releases/download/rinse-v0.1.0/pactlab-rinse_0.1.0_amd64.AppImage', sha256: sha('c'), sizeBytes: 1234, signed: true },
    ]);
  });

  it('never publishes an installer without a checksum, a plain-http link, or an empty release', () => {
    const unsummed = { ...build('x86_64-apple-darwin', 'Rinse.dmg', false), sums: new Map<string, string>() };
    expect(() => buildFeed({ builds: [unsummed], version: '0.1.0', baseUrl: 'https://example.test/', publishedAt: '2026-11-27T12:00:00.000Z', notes: [] })).toThrow('no SHA-256');
    expect(() => buildFeed({ builds: [build('x86_64-apple-darwin', 'Rinse.dmg', false)], version: '0.1.0', baseUrl: 'http://example.test/', publishedAt: '2026-11-27T12:00:00.000Z', notes: [] })).toThrow('https');
    expect(() => buildFeed({ builds: [], version: '0.1.0', baseUrl: 'https://example.test/', publishedAt: '2026-11-27T12:00:00.000Z', notes: [] })).toThrow('no installers');
  });
});
