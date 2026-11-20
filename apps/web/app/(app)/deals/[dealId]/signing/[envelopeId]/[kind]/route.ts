import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../../lib/env';

/** A completed envelope's signed document or certificate (T-136), byte-for-byte. The browser never holds the API token. */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string; envelopeId: string; kind: string }> }): Promise<Response> {
  const { dealId, envelopeId, kind } = await params;
  if (!isUuid(dealId) || !isUuid(envelopeId) || (kind !== 'signed' && kind !== 'certificate')) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/signing/${envelopeId}/artifacts/${kind}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 403 ? 403 : upstream.status === 409 ? 409 : 404 });
  return new Response(await upstream.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="Signed document.pdf"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
