import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../../lib/env';

/** The seller's own picture, also while the page is a draft (the API checks it is theirs). */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string; mediaId: string }> }): Promise<Response> {
  const { dealId, mediaId } = await params;
  if (!isUuid(dealId) || !isUuid(mediaId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/listing/media/${mediaId}/image`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 403 ? 403 : 404 });
  return new Response(upstream.body, { headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
