import { edgeLocaleConfig } from '../../lib/i18n/locales';

export const dynamic = 'force-static';

/**
 * /locales.json (T-171): the languages, country map, cookie names and entry
 * paths the CloudFront Function routes with. The CDK stack reads this file
 * from the static export at synth, so the edge always matches the build.
 */
export function GET() {
  return Response.json(edgeLocaleConfig());
}
