/**
 * Serves the static export the way pactlab.ai's CloudFront distribution does
 * (T-171): every request goes through the same CloudFront Function source the
 * stack deploys (infra/cdk/functions), with /locales.json from the build
 * prepended, and a missing key gets the 404 page. A test stubs the viewer's
 * country with the CloudFront-Viewer-Country request header.
 *
 * Run: node e2e/edge-server.ts <port>   (Node strips the types)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../out', import.meta.url));
const FUNCTIONS = fileURLToPath(new URL('../../../infra/cdk/functions', import.meta.url));
const port = Number(process.argv[2] ?? 3110);

type Field = { value: string; multiValue?: { value: string }[]; attributes?: string };
type EdgeRequest = { uri: string; method: string; headers: Record<string, Field>; cookies: Record<string, Field>; querystring: Record<string, Field> };
type EdgeResponse = { statusCode: number; statusDescription?: string; headers: Record<string, Field>; cookies?: Record<string, Field> };

const locales = readFileSync(join(OUT, 'locales.json'), 'utf8');
const load = <T>(name: string) => new Function(`var LOCALES = ${locales};\n${readFileSync(join(FUNCTIONS, `${name}.js`), 'utf8')}; return handler;`)() as T;
const viewerRequest = load<(event: { request: EdgeRequest }) => EdgeRequest | EdgeResponse>('site-viewer-request');
const viewerResponse = load<(event: { request: EdgeRequest; response: EdgeResponse }) => EdgeResponse>('site-viewer-response');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

/** The viewer request as CloudFront Functions sees it: lowercase headers, cookies and query split out. */
function edgeRequest(incoming: IncomingMessage): EdgeRequest {
  const url = new URL(incoming.url ?? '/', 'http://localhost');
  const headers: Record<string, Field> = {};
  for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string' && name !== 'cookie') headers[name] = { value };
  const cookies: Record<string, Field> = {};
  for (const pair of (incoming.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name] = { value: rest.join('=') };
  }
  const querystring: Record<string, Field> = {};
  for (const [name, value] of url.searchParams) {
    const existing = querystring[name];
    if (existing) existing.multiValue = [...(existing.multiValue ?? [{ value: existing.value }]), { value }];
    else querystring[name] = { value };
  }
  return { uri: decodeURIComponent(url.pathname), method: incoming.method ?? 'GET', headers, cookies, querystring };
}

const setCookies = (cookies: Record<string, Field> = {}) => Object.entries(cookies).map(([name, cookie]) => `${name}=${cookie.value}${cookie.attributes ? `; ${cookie.attributes}` : ''}`);

createServer((incoming, outgoing) => {
  const request = edgeRequest(incoming);
  const result = viewerRequest({ request });
  if ('statusCode' in result) {
    outgoing.writeHead(result.statusCode, {
      ...Object.fromEntries(Object.entries(result.headers).map(([name, field]) => [name, field.value])),
      'set-cookie': setCookies(result.cookies),
    });
    outgoing.end();
    return;
  }
  const file = normalize(join(OUT, result.uri));
  const found = file.startsWith(OUT) && existsSync(file) && statSync(file).isFile();
  const response = viewerResponse({ request: result, response: { statusCode: found ? 200 : 404, headers: {}, cookies: {} } });
  outgoing.writeHead(response.statusCode, {
    'content-type': TYPES[extname(found ? file : '.html')] ?? 'application/octet-stream',
    'set-cookie': setCookies(response.cookies),
  });
  outgoing.end(readFileSync(found ? file : join(OUT, '404.html')));
}).listen(port, () => process.stdout.write(`site edge server on http://localhost:${port}\n`));
