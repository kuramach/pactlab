import { llmsText } from '../../lib/seo';

export const dynamic = 'force-static';

/** /llms.txt (llmstxt.org): Pactlab in plain Markdown for AI assistants (T-085). */
export function GET() {
  return new Response(llmsText(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
