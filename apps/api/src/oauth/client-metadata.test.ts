import { describe, expect, it } from 'vitest';
import { FixtureClientMetadataFetcher, HttpsClientMetadataFetcher, isAllowedRedirectUri, isBlockedAddress, isClientMetadataUrl } from './client-metadata';

describe('client metadata documents (T-084)', () => {
  it('blocks private, loopback, link-local, metadata-service and mapped addresses', () => {
    for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'not-an-ip']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(address), address).toBe(false);
  });

  it('a client id URL is https, names a host, and has a path', () => {
    expect(isClientMetadataUrl('https://claude.ai/oauth/client.json')).toBe(true);
    for (const value of ['http://claude.ai/client.json', 'https://claude.ai', 'https://claude.ai/', 'https://127.0.0.1/client.json', 'https://[::1]/client.json', 'https://u:p@claude.ai/c.json', 'pl_abc']) {
      expect(isClientMetadataUrl(value), value).toBe(false);
    }
  });

  it('redirect URIs: https, or http on loopback; never fragments or credentials', () => {
    for (const value of ['https://app.example/cb', 'http://127.0.0.1:3000/callback', 'http://localhost:8080/cb', 'http://[::1]:9/cb']) expect(isAllowedRedirectUri(value), value).toBe(true);
    for (const value of ['http://evil.example/cb', 'https://app.example/cb#x', 'javascript:alert(1)', 'https://u:p@app.example/cb']) expect(isAllowedRedirectUri(value), value).toBe(false);
  });

  it('documents must name themselves, a client and valid redirect URIs', async () => {
    const id = 'https://client.example/meta.json';
    const fetcher = (document: unknown) => new FixtureClientMetadataFetcher({ [id]: document });
    await expect(fetcher({ client_id: id, client_name: 'Ok', redirect_uris: ['http://127.0.0.1/cb'] }).fetch(id)).resolves.toMatchObject({ clientName: 'Ok' });
    for (const bad of [{ client_id: 'https://other.example/meta.json', client_name: 'X', redirect_uris: ['http://127.0.0.1/cb'] }, { client_id: id, redirect_uris: ['http://127.0.0.1/cb'] }, { client_id: id, client_name: 'X', redirect_uris: ['http://evil.example/cb'] }, { client_id: id, client_name: 'X', redirect_uris: [] }]) {
      await expect(fetcher(bad).fetch(id)).rejects.toMatchObject({ reason: 'INVALID_DOCUMENT' });
    }
  });

  it('the live fetcher refuses a host that resolves to a private address, before connecting', async () => {
    await expect(new HttpsClientMetadataFetcher().fetch('https://localhost/client.json')).rejects.toMatchObject({ reason: 'BLOCKED_ADDRESS' });
  });
});
