import { organizationAccessToken } from '../../../lib/auth0';
import { LOGO_HEADERS, LOGO_TYPES } from '../../../lib/brand';
import { publicEnv } from '../../../lib/env';

/** The signed-in organization's logo (T-123), or the draft one for an admin's preview. */
export async function GET(request: Request): Promise<Response> {
  const which = new URL(request.url).searchParams.get('which') === 'draft' ? 'draft' : 'current';
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/organization/brand/logo?which=${which}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !LOGO_TYPES.has(type)) return new Response(null, { status: 404 });
  return new Response(upstream.body, { headers: { ...LOGO_HEADERS, 'content-type': type, 'cache-control': 'private, max-age=300' } });
}
