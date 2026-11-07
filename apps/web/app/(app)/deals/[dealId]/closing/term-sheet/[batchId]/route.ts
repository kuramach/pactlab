import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../../lib/env';

/** The agreed version's term sheet (T-107), as both sides sign it. The browser never holds the API token. */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string; batchId: string }> }): Promise<Response> {
  const { dealId, batchId } = await params;
  if (!isUuid(dealId) || !isUuid(batchId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/terms/${batchId}/term-sheet.pdf`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 403 ? 403 : 404 });
  return new Response(await upstream.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="Term sheet.pdf"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
