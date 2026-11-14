import { describe, expect, it } from 'vitest';
import { HttpsWebFetcher, SafeFetchError, type WebFetcher, type WebResponse } from '../common/safe-fetch';
import { extractBrand } from './extract';
import { sniffLogo } from './image';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 200, 0, 0, 0, 60, 8, 3, 0, 0, 0]), Buffer.from([0, 0, 0, 0]),
  Buffer.from([0, 0, 0, 6]), Buffer.from('PLTE'), Buffer.from([250, 250, 250, 0x1a, 0x7f, 0x37]), Buffer.from([0, 0, 0, 0]),
]);

/** Serves fixed pages: what a company site might look like, without the network. */
class FixtureFetcher implements WebFetcher {
  readonly asked: string[] = [];
  constructor(private readonly pages: Record<string, { status?: number; type: string; body: string | Buffer }>) {}
  async get(url: URL): Promise<WebResponse> {
    this.asked.push(url.toString());
    const page = this.pages[url.toString()];
    if (!page) return { url, status: 404, contentType: 'text/plain', body: Buffer.from('') };
    return { url, status: page.status ?? 200, contentType: page.type, body: Buffer.isBuffer(page.body) ? page.body : Buffer.from(page.body) };
  }
}

describe('brand extraction from a company website (T-123)', () => {
  it('drafts the logo from schema.org, the theme color and the nearest font', async () => {
    const fetcher = new FixtureFetcher({
      'https://acme.example/': {
        type: 'text/html; charset=utf-8',
        body: `<html><head><meta name="theme-color" content="#0B5FFF"><link rel="stylesheet" href="/site.css">
          <script type="application/ld+json">{"@type":"Organization","logo":"https://acme.example/logo.png"}</script></head><body></body></html>`,
      },
      'https://acme.example/logo.png': { type: 'image/png', body: PNG },
      'https://acme.example/site.css': { type: 'text/css', body: 'body { font-family: "Inter", Arial, sans-serif; }' },
    });
    const draft = await extractBrand(fetcher, 'https://acme.example/');
    expect(draft.logo).toMatchObject({ type: 'image/png', width: 200, height: 60 });
    expect(draft.accentColor).toBe('#0b5fff');
    expect(draft.font).toBe('INTER');
    expect(draft.notes.join(' ')).toContain('schema.org');
  });

  it('falls back to a header logo and the logo’s palette, and says what was missing', async () => {
    const fetcher = new FixtureFetcher({
      'https://plain.example/': { type: 'text/html', body: '<html><body><header><img src="/img/plain-logo.png" alt="Plain"></header></body></html>' },
      'https://plain.example/img/plain-logo.png': { type: 'image/png', body: PNG },
    });
    const draft = await extractBrand(fetcher, 'https://plain.example/');
    expect(draft.logo?.from).toContain('header');
    expect(draft.accentColor).toBe('#1a7f37');
    expect(draft.font).toBe('MANROPE');
  });

  it('never fails: an unreachable or empty site gives a draft with notes, on the default kit', async () => {
    const down = await extractBrand(new FixtureFetcher({}), 'https://gone.example/');
    expect(down).toMatchObject({ logo: null, accentColor: null, font: 'MANROPE' });
    expect(down.notes[0]).toMatch(/could not be read|answered 404/);
    const refused: WebFetcher = { get: async () => { throw new SafeFetchError('BLOCKED_ADDRESS'); } };
    expect((await extractBrand(refused, 'https://internal.example/')).notes[0]).toContain('blocked address');
  });

  it('only accepts real images: a page pretending to be a logo is skipped', async () => {
    const fetcher = new FixtureFetcher({
      'https://fake.example/': { type: 'text/html', body: '<meta property="og:image" content="/logo.png">' },
      'https://fake.example/logo.png': { type: 'image/png', body: '<html>not an image</html>' },
    });
    expect((await extractBrand(fetcher, 'https://fake.example/')).logo).toBeNull();
    expect(sniffLogo(Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 120 40"></svg>'))).toEqual({ type: 'image/svg+xml', width: 120, height: 40 });
  });

  it('the live fetcher refuses http, and addresses inside the network (SSRF)', async () => {
    const fetcher = new HttpsWebFetcher();
    await expect(fetcher.get(new URL('http://acme.example/'), { maxBytes: 100, accept: 'text/html' })).rejects.toMatchObject({ reason: 'NOT_HTTPS' });
    for (const target of ['https://127.0.0.1/', 'https://10.0.0.5/', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://[::ffff:10.0.0.1]/']) {
      await expect(fetcher.get(new URL(target), { maxBytes: 100, accept: 'text/html' }), target).rejects.toMatchObject({ reason: 'BLOCKED_ADDRESS' });
    }
  });
});
