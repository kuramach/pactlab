import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../../lib/env';

/**
 * The document's stored original, fetched server-side for the review viewer:
 * the browser never holds the API token. The API checks access, re-verifies
 * the file's hash and audits the read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string; documentId: string }> }): Promise<Response> {
  const { dealId, documentId } = await params;
  if (!isUuid(dealId) || !isUuid(documentId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/documents/${documentId}/original`, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 410 ? 410 : upstream.status === 404 ? 404 : 502 });
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'inline',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
