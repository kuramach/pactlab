import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../../lib/env';

/** One gallery photo, passed through the API (the maps key never reaches the browser). */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string; index: string }> }): Promise<Response> {
  const { dealId, index } = await params;
  if (!isUuid(dealId) || !/^\d{1,2}$/.test(index)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/property-profile/photos/${index}/image`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 403 ? 403 : 404 });
  return new Response(upstream.body, { headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
}
