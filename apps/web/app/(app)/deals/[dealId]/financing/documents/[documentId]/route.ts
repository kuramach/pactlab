import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../../lib/env';

/**
 * A financing document (T-117), fetched server-side. The API decides who may read it: the buyer
 * who holds it, or the seller once it is shared; it re-checks the hash and audits the read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string; documentId: string }> }): Promise<Response> {
  const { dealId, documentId } = await params;
  if (!isUuid(dealId) || !isUuid(documentId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/financing/documents/${documentId}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  return new Response(upstream.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
