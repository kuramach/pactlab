import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../lib/env';

/**
 * A file attached to a bid, fetched server-side (the browser never holds the
 * API token). The API decides who may read it — the bidder who attached it or
 * the seller's side — re-checks its hash and audits the read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string; fileId: string }> }): Promise<Response> {
  const { dealId, fileId } = await params;
  if (!isUuid(dealId) || !isUuid(fileId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/bid-files/${fileId}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
