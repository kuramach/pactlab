import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_AUTH, API_CONVENTIONS, API_ERROR_EXAMPLE, API_FAMILIES, API_MCP, API_PAGE, MCP_TOOLS } from './api-docs';
import { BANNED_WORDS } from './content';
import { llmsText, SITE_ROUTES } from './seo';

/** The API's source: the page is checked against what the code opens to tokens, not against itself. */
const API_SRC = join(dirname(fileURLToPath(import.meta.url)), '../../api/src');

function files(dir: string, suffix: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, suffix);
    return name.endsWith(suffix) ? [path] : [];
  });
}

/** `METHOD /path` for every route marked `@ApiAccess(...)`, in OpenAPI form. */
function apiRoutes(): string[] {
  return files(API_SRC, '.controller.ts').flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const base = /@Controller\('([^']*)'\)/.exec(source)?.[1] ?? '';
    return [...source.matchAll(/@ApiAccess\([^\n]*\)\s*\n\s*@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g)].map(([, method, path]) => {
      const full = `/${[base, path ?? ''].join('/').split('/').filter(Boolean).join('/')}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      return `${(method ?? '').toUpperCase()} ${full}`;
    });
  });
}

const copy = () => JSON.stringify({ API_PAGE, API_FAMILIES, API_AUTH, API_CONVENTIONS, API_MCP, MCP_TOOLS, API_ERROR_EXAMPLE });

describe('the public API page (T-085 Part 6)', () => {
  it('documents exactly the routes the API opens to tokens', () => {
    const documented = API_FAMILIES.flatMap((family) => family.operations.map((operation) => `${operation.method} ${operation.path}`));
    const real = apiRoutes();
    expect(real.length).toBeGreaterThan(10);
    expect([...documented].sort()).toEqual([...real].sort());
  });

  it('lists exactly the tools the MCP server registers', () => {
    const source = readFileSync(join(API_SRC, 'mcp/mcp.service.ts'), 'utf8');
    const registered = [...source.matchAll(/\btool\(\s*'([a-z_]+)'/g)].map(([, name]) => name);
    expect([...MCP_TOOLS.read, ...MCP_TOOLS.propose].map((tool) => tool.name).sort()).toEqual(registered.sort());
  });

  it('covers every resource family, with one request and response each', () => {
    expect(API_FAMILIES.map((family) => family.slug)).toEqual(['pacts', 'evidence', 'findings', 'documents', 'valuation', 'reports']);
    for (const family of API_FAMILIES) {
      expect(family.example.request.startsWith('curl '), family.slug).toBe(true);
      expect(() => JSON.parse(family.example.response) as unknown, family.slug).not.toThrow();
    }
    // The agent-side families are on the page through the MCP tools.
    for (const name of ['get_claims_register', 'get_valuation_bridge', 'get_post_close_register', 'get_foresight', 'propose_term']) expect(copy()).toContain(name);
  });

  it('carries no credential and no customer data: placeholders and HealthyCo only', () => {
    const text = copy();
    for (const family of API_FAMILIES) expect(family.example.request).toContain('$ACCESS_TOKEN');
    // Nothing that looks like a JWT, a bearer value, a secret key or an email address.
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/Bearer (?!\$ACCESS_TOKEN)/);
    expect(text).not.toMatch(/\b(sk|pk|rk)_(live|test)_/);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    // Synthetic records only (fixtures/synthetic/HealthyCo).
    expect(text).toContain('HealthyCo');
    expect(text).toContain('(synthetic)');
  });

  it('is in the sitemap and llms.txt, in the site voice', () => {
    expect(SITE_ROUTES).toContain('/api');
    expect(llmsText()).toContain('https://pactlab.ai/api/');
    const lower = copy().toLowerCase();
    for (const word of BANNED_WORDS) expect(lower).not.toContain(word);
    expect(API_PAGE.metaDescription.length).toBeLessThanOrEqual(300);
  });
});
