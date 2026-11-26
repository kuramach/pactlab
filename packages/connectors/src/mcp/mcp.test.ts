import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ADAPTER_EVIDENCE_TYPES,
  defaultDirectionFor,
  VALUATION_DIRECTION_MAP,
} from '../valuation-direction';
import type { FetchLike } from '../http/cassette';
import {
  createMcpAdapter,
  DEPENDENCY_ALERT_EVIDENCE_TYPE,
  defineMcpEvidenceProfile,
  GITHUB_MCP_FIXTURE,
  guardedMcpFetch,
  MCP_EVIDENCE_PROFILES,
  MCP_RESPONSE_MAX_BYTES,
  McpAdapterError,
  mcpServerUrlProblem,
  parseMcpEvidenceServers,
  SdkMcpSessionFactory,
  type AllowedMcpServer,
  type McpServerPolicy,
} from './index';
import { dependabotPage, type SyntheticAlert } from './github/fixture';

const scope = { organizationId: 'o', dealId: 'd', connectionId: 'c', credentialRef: null };
const tokenScope = { ...scope, credentialRef: 'secretref:o/d/mcp/c' };
const ENDPOINT = 'https://mcp.example.com/mcp/x/dependabot/readonly';
const server: AllowedMcpServer = {
  id: 'github',
  profile: 'github',
  url: ENDPOINT,
  host: 'mcp.example.com',
};
const policy: McpServerPolicy = { servers: [server] };
const secrets = { put: async () => undefined, get: async () => 'ghp_synthetic_token_0000000000' };
const config = (repository: string) => ({ server: 'github', target: { repository } });

describe('MCP evidence profiles', () => {
  it('maps every profile evidence type to a valuation direction, and the map test sees them', () => {
    for (const profile of Object.values(MCP_EVIDENCE_PROFILES))
      for (const type of profile.evidenceTypes) {
        expect(VALUATION_DIRECTION_MAP[type]?.length ?? 0, type).toBeGreaterThan(0);
        expect(ADAPTER_EVIDENCE_TYPES as readonly string[]).toContain(type);
      }
    expect(defaultDirectionFor(DEPENDENCY_ALERT_EVIDENCE_TYPE, 'open-vulnerability')).toBe(-1);
  });

  it('refuses to register a profile whose evidence has no valuation direction', () => {
    const profile = {
      ...MCP_EVIDENCE_PROFILES['github']!,
      id: 'unmapped',
      evidenceTypes: ['mcp.unmapped'],
    };
    expect(() => defineMcpEvidenceProfile(profile)).toThrow(/no VALUATION_DIRECTION_MAP entry/);
    expect(() =>
      defineMcpEvidenceProfile({
        ...profile,
        evidenceTypes: [DEPENDENCY_ALERT_EVIDENCE_TYPE],
        tools: [],
      }),
    ).toThrow(/names no tools/);
  });
});

describe('MCP server allowlist', () => {
  it('parses the operator list and refuses anything that is not an https host', () => {
    expect(parseMcpEvidenceServers('', ['github'])).toEqual({ servers: [] });
    expect(parseMcpEvidenceServers(`github=${ENDPOINT}`, ['github']).servers).toEqual([server]);
    for (const bad of [
      'github=http://mcp.example.com/mcp',
      'github=https://127.0.0.1/mcp',
      'github=https://[::1]/mcp',
      'github=https://localhost/mcp',
      'github=https://mcp.example.com:8443/mcp',
      'github=https://user:pw@mcp.example.com/mcp',
      'github=https://mcp.example.com/mcp?x=1',
      'github=https://mcp.example.com/mcp#f',
      'linear=https://mcp.example.com/mcp',
      'https://mcp.example.com/mcp',
      `github=${ENDPOINT},github=${ENDPOINT}`,
    ])
      expect(() => parseMcpEvidenceServers(bad, ['github']), bad).toThrow(/MCP_EVIDENCE_SERVERS/);
    expect(
      mcpServerUrlProblem('https://api.githubcopilot.com/mcp/x/dependabot/readonly'),
    ).toBeNull();
  });

  it('a live connection to a server off the list fails its checks and its sync', async () => {
    const adapter = createMcpAdapter('LIVE', config('troubledco/core'), {
      policy: { servers: [] },
      secrets,
    });
    const result = await adapter!.validateConnection(tokenScope);
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: 'reachability', status: 'FAIL' });
    expect(result.checks[0]?.detail).toMatch(/ask your Pactlab operator/);
    await expect(adapter!.evidenceSource(tokenScope).pull()).rejects.toThrow(McpAdapterError);
  });

  it('refuses unknown servers and targets that are not repositories', () => {
    expect(createMcpAdapter('LIVE', { server: 'nope', target: { repository: 'a/b' } })).toBeNull();
    expect(
      createMcpAdapter('LIVE', { server: 'github', target: { repository: 'a/..' } }),
    ).toBeNull();
    expect(createMcpAdapter('LIVE', { server: 'github', target: { repo: 'a/b' } })).toBeNull();
    expect(
      createMcpAdapter('LIVE', {
        server: 'https://evil.example.com',
        target: { repository: 'a/b' },
      }),
    ).toBeNull();
  });
});

describe('guarded MCP fetch', () => {
  const seen: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const base: FetchLike = async (url, init) => {
    seen.push({ url, init });
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const guarded = guardedMcpFetch(server, base, {
    Authorization: 'Bearer t',
    'X-MCP-Readonly': 'true',
  });

  it('sends only to the approved endpoint, never follows redirects, and adds the headers', async () => {
    await expect(
      guarded('https://evil.example.com/mcp/x/dependabot/readonly', { method: 'POST', body: '{}' }),
    ).rejects.toThrow(McpAdapterError);
    await expect(
      guarded('https://mcp.example.com/other', { method: 'POST', body: '{}' }),
    ).rejects.toThrow(McpAdapterError);
    await expect(guarded(`${ENDPOINT}?x=1`, { method: 'POST', body: '{}' })).rejects.toThrow(
      McpAdapterError,
    );
    await expect(guarded(ENDPOINT, { method: 'PUT', body: '{}' })).rejects.toThrow(McpAdapterError);
    expect(seen).toHaveLength(0);
    const response = await guarded(ENDPOINT, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(seen[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        authorization: 'Bearer t',
        'content-type': 'application/json',
        'x-mcp-readonly': 'true',
      },
    });
  });

  it('answers GET locally with 405, so no standing stream is opened', async () => {
    const before = seen.length;
    expect((await guarded(ENDPOINT, { method: 'GET' })).status).toBe(405);
    expect(seen).toHaveLength(before);
  });

  it('treats a redirect as unreachable and caps the size', async () => {
    const redirecting = guardedMcpFetch(
      server,
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
      {},
    );
    await expect(redirecting(ENDPOINT, { method: 'POST', body: '{}' })).rejects.toMatchObject({
      reason: 'UNREACHABLE',
    });
    const huge = guardedMcpFetch(
      server,
      async () => new Response('x'.repeat(MCP_RESPONSE_MAX_BYTES + 1)),
      {},
    );
    await expect(huge(ENDPOINT, { method: 'POST', body: '{}' })).rejects.toMatchObject({
      reason: 'TOO_LARGE',
    });
  });
});

describe('GitHub MCP profile (fixture)', () => {
  it('validates, and reads alerts as evidence with no people, prose or links', async () => {
    const adapter = createMcpAdapter('FIXTURE', config('troubledco/core'))!;
    const validation = await adapter.validateConnection(scope);
    expect(validation.ok).toBe(true);
    expect(validation.checks.find((check) => check.name === 'mappings')?.detail).toContain(
      DEPENDENCY_ALERT_EVIDENCE_TYPE,
    );
    const { records, issues } = await adapter.evidenceSource(scope).pull();
    expect(issues).toEqual([]);
    expect(records.map((record) => record.canonical['alertNumber'])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(
      records
        .filter((record) => record.canonical['state'] === 'open')
        .map((record) => record.canonical['severity']),
    ).toEqual(['critical', 'high', 'low']);
    for (const record of records) {
      expect(record.evidenceType).toBe(DEPENDENCY_ALERT_EVIDENCE_TYPE);
      expect(record.locator).toMatchObject({
        kind: 'provider_record',
        system: 'mcp:github',
        resource: 'troubledco/core/dependabot_alerts',
      });
      expect(record.quote).toBe(JSON.stringify(record.canonical));
      expect(JSON.stringify(record)).not.toMatch(
        /tc-dev-01|Ivan Petrov|Ignore previous instructions|html_url|api\.github\.com|dismissed_by/,
      );
    }
    expect(records[2]?.canonical).toMatchObject({
      state: 'dismissed',
      dismissedReason: 'tolerable_risk',
      dismissedAt: '2026-02-01T09:00:00.000Z',
    });
    // A replay reads the same records.
    expect((await adapter.evidenceSource(scope).pull()).records).toEqual(records);
  });

  it('surfaces a refused credential as a source issue, not as silence', async () => {
    const { records, issues } = await createMcpAdapter('FIXTURE', config('sparseco/app'))!
      .evidenceSource(scope)
      .pull();
    expect(records).toEqual([]);
    expect(issues).toHaveLength(4);
    expect(
      issues.every(
        (issue) =>
          issue.code === 'PERMISSION_DENIED' && !/403|Resource not accessible/.test(issue.detail),
      ),
    ).toBe(true);
  });

  it('follows the cursor across pages and keeps what does not parse out', async () => {
    const many: SyntheticAlert[] = Array.from({ length: 230 }, (_, index) => ({
      number: index + 1,
      state: 'open',
      severity: 'medium',
      ecosystem: 'npm',
      name: `pkg-${index}`,
      manifest: 'package-lock.json',
      ghsa: `GHSA-syn1-${index}`,
      cve: null,
      range: '< 1.0.0',
      patched: '1.0.0',
      createdAt: '2026-01-01T00:00:00Z',
    }));
    const calls: unknown[] = [];
    const fixtures = {
      github: {
        tools: GITHUB_MCP_FIXTURE.tools,
        call: (_name: string, args: Readonly<Record<string, unknown>>) => {
          calls.push(args);
          if (args['state'] === 'fixed') return { isError: false, text: ['not json'] };
          return {
            isError: false,
            text: [dependabotPage('troubledco/core', args, args['state'] === 'open' ? many : [])],
          };
        },
      },
    };
    const { records, issues } = await createMcpAdapter('FIXTURE', config('troubledco/core'), {
      fixtures,
    })!
      .evidenceSource(scope)
      .pull();
    expect(records).toHaveLength(230);
    expect(calls.filter((args) => (args as { state: string }).state === 'open')).toHaveLength(3);
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_VALUE',
        detail: expect.stringMatching(/fixed alert page/),
      }),
    ]);
  });

  it('never calls a tool outside the profile, and fails scopes when the server calls its tool writable', async () => {
    const fixtures = {
      github: {
        ...GITHUB_MCP_FIXTURE,
        tools: [{ name: 'list_dependabot_alerts', readOnlyHint: false }],
      },
    };
    const validation = await createMcpAdapter('FIXTURE', config('troubledco/core'), {
      fixtures,
    })!.validateConnection(scope);
    expect(validation.checks.find((check) => check.name === 'scopes')).toMatchObject({
      status: 'FAIL',
    });
    const missing = await createMcpAdapter('FIXTURE', config('troubledco/core'), {
      fixtures: { github: { ...GITHUB_MCP_FIXTURE, tools: [] } },
    })!.validateConnection(scope);
    expect(missing.checks.find((check) => check.name === 'scopes')?.detail).toMatch(
      /security_events/,
    );
  });
});

/**
 * End to end through the official SDK on both sides: Pactlab's live client, the guarded
 * fetch, and an in-process MCP server that answers as GitHub's documents (no network).
 */
describe('GitHub MCP profile (live client against an SDK server)', () => {
  function inProcessServer(options: { status?: number } = {}) {
    const received: { authorization: string | null; readonly: string | null; method: string }[] =
      [];
    const writes: unknown[] = [];
    const fetch: FetchLike = async (url, init) => {
      const headers = new Headers(init?.headers);
      received.push({
        authorization: headers.get('authorization'),
        readonly: headers.get('x-mcp-readonly'),
        method: init?.method ?? 'GET',
      });
      if (options.status)
        return new Response('{"error":"bad credentials"}', { status: options.status });
      const mcp = new McpServer({ name: 'synthetic-github', version: '0.0.0' });
      mcp.registerTool(
        'list_dependabot_alerts',
        {
          description: 'List dependabot alerts',
          inputSchema: {
            owner: z.string(),
            repo: z.string(),
            state: z.string().optional(),
            severity: z.string().optional(),
            perPage: z.number().optional(),
            after: z.string().optional(),
          },
          annotations: { readOnlyHint: true },
        },
        async (args) => {
          const answer = GITHUB_MCP_FIXTURE.call('list_dependabot_alerts', args);
          return {
            isError: answer.isError,
            content: answer.text.map((value) => ({ type: 'text' as const, text: value })),
          };
        },
      );
      mcp.registerTool(
        'create_issue',
        {
          description: 'Create an issue',
          inputSchema: { title: z.string() },
          annotations: { readOnlyHint: false },
        },
        async (args) => {
          writes.push(args);
          return { content: [{ type: 'text' as const, text: 'created' }] };
        },
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      return transport.handleRequest(
        new Request(url, {
          method: init?.method ?? 'GET',
          headers,
          ...(init?.body ? { body: init.body } : {}),
        }),
      );
    };
    return { fetch, received, writes };
  }

  it('validates and syncs through the SDK, sending the credential and the read-only header', async () => {
    const remote = inProcessServer();
    const options = { policy, secrets, sessions: new SdkMcpSessionFactory(remote.fetch) };
    const adapter = createMcpAdapter('LIVE', config('troubledco/core'), options)!;
    const validation = await adapter.validateConnection(tokenScope);
    expect(validation.checks.map((check) => check.status)).toEqual([
      'PASS',
      'PASS',
      'PASS',
      'PASS',
    ]);
    const { records, issues } = await adapter.evidenceSource(tokenScope).pull();
    expect(issues).toEqual([]);
    expect(records).toHaveLength(5);
    expect(records[0]?.locator).toMatchObject({ site: 'mcp.example.com' });
    expect(remote.received.length).toBeGreaterThan(0);
    expect(
      remote.received.every(
        (request) =>
          request.authorization === 'Bearer ghp_synthetic_token_0000000000' &&
          request.readonly === 'true',
      ),
    ).toBe(true);
    expect(remote.received.some((request) => request.method === 'GET')).toBe(false);
    expect(remote.writes).toEqual([]);
  });

  it('refuses to call a writable tool even though the server offers it', async () => {
    const remote = inProcessServer();
    const session = await new SdkMcpSessionFactory(remote.fetch).open({
      server,
      headers: {},
      tools: ['list_dependabot_alerts'],
    });
    expect((await session.listTools()).map((tool) => tool.name)).toContain('create_issue');
    await expect(session.callTool('create_issue', { title: 'x' })).rejects.toMatchObject({
      reason: 'TOOL_NOT_ALLOWED',
    });
    await session.close();
    expect(remote.writes).toEqual([]);
  });

  it('reports a refused credential without the server’s words', async () => {
    const remote = inProcessServer({ status: 401 });
    const adapter = createMcpAdapter('LIVE', config('troubledco/core'), {
      policy,
      secrets,
      sessions: new SdkMcpSessionFactory(remote.fetch),
    })!;
    const validation = await adapter.validateConnection(tokenScope);
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'credentials')).toMatchObject({
      status: 'FAIL',
      detail: 'The server refused the credential',
    });
    expect(JSON.stringify(validation)).not.toContain('bad credentials');
  });
});
