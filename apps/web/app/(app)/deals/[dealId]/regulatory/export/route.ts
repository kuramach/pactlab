import { isUuid } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../../../lib/auth0';
import { publicEnv } from '../../../../../../lib/env';

/**
 * Regulator-facing export of one candidate package (T-091): the deal lead
 * confirms it leaves the pact, the API builds the file and audits the act, and
 * it downloads as Markdown. The browser never holds the API token; a
 * cross-site post is refused.
 */
export async function POST(request: Request, { params }: { params: Promise<{ dealId: string }> }): Promise<Response> {
  const { dealId } = await params;
  if (!isUuid(dealId)) return new Response(null, { status: 404 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const form = await request.formData();
  const packageId = String(form.get('packageId') ?? '');
  const back = (outcome: string) => Response.redirect(new URL(`/deals/${dealId}/regulatory?outcome=${outcome}#packages`, request.url), 303);
  if (form.get('acknowledged') !== 'on') return back('export-unconfirmed');
  const token = await organizationAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const upstream = await fetch(new URL(`/v1/deals/${dealId}/regulatory/exports`, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ packageId, acknowledged: true }),
    cache: 'no-store',
  });
  if (upstream.status === 403) return back('export-forbidden');
  if (!upstream.ok) return back('export-failed');
  const file = (await upstream.json()) as { fileName: string; content: string };
  return new Response(file.content, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
