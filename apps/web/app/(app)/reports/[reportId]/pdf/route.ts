import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../lib/auth0';
import { publicEnv } from '../../../../../lib/env';

/** A report version's PDF (T-110). The browser never holds the API token; the download is audited by the API. */
export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }): Promise<Response> {
  const { reportId } = await params;
  if (!isUuid(reportId)) return new Response(null, { status: 404 });
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/reports/${reportId}/pdf`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!upstream.ok) return new Response(null, { status: upstream.status === 403 ? 403 : 404 });
  return new Response(await upstream.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="Pactlab report.pdf"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
