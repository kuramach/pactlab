import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authApi = vi.fn();
const storeNativeSession = vi.fn();
vi.mock('../../../lib/native-session', () => ({ authApi: (...args: unknown[]) => authApi(...args), storeNativeSession: (...args: unknown[]) => storeNativeSession(...args) }));
vi.mock('../../../lib/env', () => ({ serverEnv: () => ({ APP_BASE_URL: 'https://app.pactlab.example' }) }));

const { GET } = await import('./route');
const TOKEN = 'a'.repeat(43);
// Behind the load balancer a route handler sees the server's own address, not the public one.
const internal = (path: string) => new NextRequest(`http://0.0.0.0:3000${path}`);

describe('shared-demo link (T-113)', () => {
  beforeEach(() => {
    authApi.mockReset();
    storeNativeSession.mockReset();
  });

  it('signs in and sends the visitor to the pacts on the public address', async () => {
    authApi.mockResolvedValue({ status: 200, data: { token: 't', expiresAt: '2030-01-01T00:00:00Z', organizationId: 'o' } });
    const response = await GET(internal(`/demo/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) });
    expect(authApi).toHaveBeenCalledWith('/v1/auth/demo-link', { token: TOKEN });
    expect(storeNativeSession).toHaveBeenCalledOnce();
    expect(response.headers.get('location')).toBe('https://app.pactlab.example/deals');
  });

  it('sends an ended or malformed link to "this demo has ended", never to an internal host', async () => {
    authApi.mockResolvedValue({ status: 401, data: null });
    const ended = await GET(internal(`/demo/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) });
    expect(ended.headers.get('location')).toBe('https://app.pactlab.example/demo/ended');
    const malformed = await GET(internal('/demo/short'), { params: Promise.resolve({ token: 'short' }) });
    expect(malformed.headers.get('location')).toBe('https://app.pactlab.example/demo/ended');
    expect(storeNativeSession).not.toHaveBeenCalled();
  });
});
