import { describe, expect, it } from 'vitest';
import { startCloudSignIn } from './cloud-signin';

describe('the seller’s own drive sign-in on a loopback address (T-178e)', () => {
  it('sends the seller to the provider with PKCE, refuses a mismatched return, and exchanges the code it sent back', async () => {
    const tokenRequests: string[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      tokenRequests.push(`${url} ${String(init.body)}`);
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 });
    };
    const started = await startCloudSignIn('ONEDRIVE', { ONEDRIVE: 'rinse-client' }, fetcher);
    const authorize = new URL(started.url);
    expect(authorize.origin + authorize.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
    expect(redirect.hostname).toBe('127.0.0.1');

    const back = await fetch(`${redirect.href}?code=c0de&state=${authorize.searchParams.get('state')}`);
    expect(back.status).toBe(200);
    expect(await back.text()).toContain('You can close this window');
    const session = await started.session;
    expect(session.refreshToken).toBe('rt');
    expect(tokenRequests[0]).toMatch(/^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token .*code=c0de.*code_verifier=/);

    const forged = await startCloudSignIn('GOOGLE_DRIVE', { GOOGLE_DRIVE: 'rinse-client' }, fetcher);
    const forgedRedirect = new URL(new URL(forged.url).searchParams.get('redirect_uri') ?? '');
    expect((await fetch(`${forgedRedirect.href}?code=c0de&state=not-it`)).status).toBe(400);
    await expect(forged.session).rejects.toThrow('did not match');
  });

  it('keeps a drive with no registration, and Box, off', async () => {
    await expect(startCloudSignIn('GOOGLE_DRIVE', {})).rejects.toThrow('not registered');
    await expect(startCloudSignIn('BOX', { BOX: 'id' })).rejects.toThrow('not registered');
  });
});
