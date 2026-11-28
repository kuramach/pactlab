/**
 * The public API page (T-085 Part 6): what the Pactlab API and MCP server
 * do, written from the routes the API actually opens to tokens
 * (`@ApiAccess`, served as `/v1/openapi.json`) and the tools the MCP server
 * registers (apps/api/src/mcp). Regenerate this page's lists when either
 * changes; `api-docs.test.ts` checks the families and that no example
 * carries a credential.
 *
 * Every example uses HealthyCo, the synthetic company in
 * fixtures/synthetic/HealthyCo. Ids are illustrative and tokens are
 * placeholders, never real values.
 */

import type { IconName } from './icons';

/** The API's address. The app and API live at app.pactlab.ai (docs/runbooks/mcp.md). */
export const API_ORIGIN = 'https://app.pactlab.ai';

export const API_PAGE = {
  metaTitle: 'Pactlab API and MCP server for deal diligence',
  metaDescription:
    'The Pactlab REST API and MCP server: read pacts, evidence, findings, documents, valuation scenarios and reports with per-person OAuth, and give AI agents the claims register, valuation bridge and Foresight.',
  eyebrow: 'Developers',
  title: 'Does Pactlab have an API for findings and valuation? Yes: REST for your systems, MCP for your agents.',
  body: 'Read pacts, evidence, findings, documents, valuation scenarios and reports from your own scripts. Every call runs as a named person, inside that person’s role, and is in the audit log under their name. Approvals stay in the app, with a person.',
  purposeTitle: 'What the API is for',
  purpose: [
    {
      icon: 'Database',
      title: 'Feed your own systems',
      body: 'Pull the findings register, valuation scenarios and report history into a deal tracker, a data warehouse or an investment-committee pack, without re-keying.',
    },
    {
      icon: 'FileStack',
      title: 'Push evidence in',
      body: 'Upload documents and request missing ones from the other side from a script. Uploads are malware-scanned before anything reads them.',
    },
    {
      icon: 'Link2',
      title: 'Trace a number to its source',
      body: 'Every evidence item has its source system, record id and content hash, and a lineage call shows the findings, assumptions, scenarios and terms it supports.',
    },
    {
      icon: 'ClipboardCheck',
      title: 'Draft, never decide',
      body: 'With write access a script can draft a finding. It still needs review and acceptance by a person in Pactlab before it counts toward valuation.',
    },
  ],
} as const satisfies { purpose: readonly { icon: IconName; title: string; body: string }[] } & Record<string, unknown>;

export interface ApiOperationDoc {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly summary: string;
}

export interface ApiFamily {
  readonly slug: string;
  readonly name: string;
  readonly body: string;
  readonly operations: readonly ApiOperationDoc[];
  readonly example: { readonly request: string; readonly response: string };
}

const DEAL = '0193c2a4-5b10-7c1e-9a52-6e1f0d3b7a01';
const auth = '-H "Authorization: Bearer $ACCESS_TOKEN"';

/** The REST resource families, in the order a pact uses them. Paths match `/v1/openapi.json`. */
export const API_FAMILIES: readonly ApiFamily[] = [
  {
    slug: 'pacts',
    name: 'Pacts',
    body: 'The deals you can see, with phase, target, parties and, on the buyer side, the asking price. Search with q and narrow by phase.',
    operations: [
      { method: 'GET', path: '/v1/deals', summary: 'List your pacts' },
      { method: 'GET', path: '/v1/deals/summary', summary: 'Totals across your pacts' },
      { method: 'GET', path: '/v1/deals/{dealId}', summary: 'Get a pact' },
    ],
    example: {
      request: `curl -s "${API_ORIGIN}/v1/deals?q=HealthyCo&limit=1" \\\n  ${auth}`,
      response: JSON.stringify(
        {
          items: [
            {
              id: DEAL,
              name: 'Project Fjord',
              targetName: 'HealthyCo',
              transactionType: 'PRIVATE_ACQUIRER',
              phase: 'DILIGENCE',
              baseCurrency: 'USD',
              askingPrice: { amount: '2400000.00', currency: 'USD', basis: 'ENTERPRISE_VALUE' },
              myRole: 'DEAL_LEAD',
              createdAt: '2026-10-02T09:14:00.000Z',
            },
          ],
          nextCursor: null,
          total: 1,
          limit: 1,
        },
        null,
        2,
      ),
    },
  },
  {
    slug: 'evidence',
    name: 'Evidence and lineage',
    body: 'Normalized evidence from connected systems and imports, each with its source system, record id and content hash, and what it supports downstream.',
    operations: [
      { method: 'GET', path: '/v1/deals/{dealId}/evidence', summary: 'List evidence' },
      { method: 'GET', path: '/v1/deals/{dealId}/evidence/{evidenceId}', summary: 'Get evidence' },
      { method: 'GET', path: '/v1/deals/{dealId}/evidence/{evidenceId}/lineage', summary: 'Evidence lineage' },
    ],
    example: {
      request: `curl -s "${API_ORIGIN}/v1/deals/${DEAL}/evidence?limit=1" \\\n  ${auth}`,
      response: JSON.stringify(
        {
          items: [
            {
              id: '0193c2b0-1e44-7a90-8d31-2f5c6b7e9a10',
              dealId: DEAL,
              evidenceType: 'billing.invoice_line',
              sourceSystem: 'stripe',
              sourceRecordId: 'il_hc_00001',
              observedAt: '2025-07-01T00:00:00.000Z',
              contentHash: 'sha256:9f2c…',
              visibility: 'BUYER_ONLY',
              canonical: { line_id: 'il_hc_00001', customer_name: 'Aurora Logistics (synthetic)', currency: 'USD', amount: '3400.00', interval: 'month' },
            },
          ],
          nextCursor: '…',
          total: 214,
          limit: 1,
        },
        null,
        2,
      ),
    },
  },
  {
    slug: 'findings',
    name: 'Findings',
    body: 'The findings register: domain, severity, confidence, status, the evidence each cites and any priced risk. Confidential findings appear only to roles that may see them.',
    operations: [
      { method: 'GET', path: '/v1/deals/{dealId}/findings', summary: 'List findings' },
      { method: 'GET', path: '/v1/deals/{dealId}/findings/summary', summary: 'Finding counts' },
      { method: 'GET', path: '/v1/deals/{dealId}/findings/{findingId}', summary: 'Get a finding' },
      { method: 'POST', path: '/v1/deals/{dealId}/findings', summary: 'Create a draft finding (api:write)' },
    ],
    example: {
      request: `curl -s "${API_ORIGIN}/v1/deals/${DEAL}/findings?status=ACCEPTED&limit=1" \\\n  ${auth}`,
      response: JSON.stringify(
        {
          items: [
            {
              id: '0193c2c8-7f02-7b4d-b6e0-41a9c3d5e811',
              domain: 'FINANCIAL',
              title: 'Management ARR reconciles to billing',
              severity: 'INFO',
              confidence: 'HIGH',
              status: 'ACCEPTED',
              origin: 'HEURISTIC',
              direction: 1,
              pricedRisk: null,
              evidence: [{ evidenceItemId: '0193c2b0-1e44-7a90-8d31-2f5c6b7e9a10', toolName: 'arr-reconciliation', toolVersion: '1.3.0' }],
            },
          ],
          nextCursor: null,
          total: 1,
          limit: 1,
        },
        null,
        2,
      ),
    },
  },
  {
    slug: 'documents',
    name: 'Documents and requests',
    body: 'The pact’s document library (details, classification and review status, not content), uploads, and requests to the other side for what is missing.',
    operations: [
      { method: 'GET', path: '/v1/deals/{dealId}/documents', summary: 'List documents' },
      { method: 'GET', path: '/v1/deals/{dealId}/documents/{documentId}', summary: 'Get a document' },
      { method: 'POST', path: '/v1/deals/{dealId}/documents', summary: 'Upload a document (api:write)' },
      { method: 'GET', path: '/v1/deals/{dealId}/document-requests', summary: 'List document requests' },
      { method: 'POST', path: '/v1/deals/{dealId}/document-requests', summary: 'Request a document (api:write)' },
    ],
    example: {
      request: `curl -s "${API_ORIGIN}/v1/deals/${DEAL}/document-requests" \\\n  ${auth}`,
      response: JSON.stringify(
        {
          items: [
            {
              id: '0193c2d1-0a6e-7f15-9c47-8b2e5d1f3a22',
              status: 'OPEN',
              note: 'Signed order forms for the top ten customers, please.',
              createdAt: '2026-10-05T13:40:00.000Z',
              items: [{ id: 'CUSTOMER_CONTRACT', label: 'Customer contract', received: false, documentIds: [] }],
            },
          ],
        },
        null,
        2,
      ),
    },
  },
  {
    slug: 'valuation',
    name: 'Valuation scenarios',
    body: 'Buyer side only. Each scenario with its versioned assumptions and the results of the deterministic engine. Money is a decimal string with its currency, never a float.',
    operations: [
      { method: 'GET', path: '/v1/deals/{dealId}/valuation/scenarios', summary: 'List valuation scenarios' },
      { method: 'GET', path: '/v1/deals/{dealId}/valuation/scenarios/{scenarioId}', summary: 'Get a valuation scenario' },
    ],
    example: {
      request: `curl -s "${API_ORIGIN}/v1/deals/${DEAL}/valuation/scenarios" \\\n  ${auth}`,
      response: JSON.stringify(
        {
          items: [
            {
              id: '0193c2e3-44b1-7d02-a8f9-3c6e7b1d2f33',
              name: 'Base case',
              currency: 'USD',
              status: 'APPROVED',
              scenarioCase: 'BASE',
              assumptionVersion: 3,
              updatedAt: '2026-10-09T16:02:00.000Z',
            },
          ],
          nextCursor: null,
          total: 1,
          limit: 50,
        },
        null,
        2,
      ),
    },
  },
  {
    slug: 'reports',
    name: 'Reports',
    body: 'Every report version you generated, newest first. PDFs are downloaded in the app.',
    operations: [{ method: 'GET', path: '/v1/reports', summary: 'Report history' }],
    example: {
      request: `curl -s "${API_ORIGIN}/v1/reports?limit=1" \\\n  ${auth}`,
      response: JSON.stringify(
        {
          items: [
            {
              id: '0193c2f0-9d27-7e88-b1c4-5a3f8e2d6b44',
              scope: 'PACT',
              dealId: DEAL,
              dealName: 'Project Fjord',
              version: 2,
              status: 'READY',
              generatedAt: '2026-10-10T08:30:00.000Z',
              dataAsOf: '2026-10-10T08:29:41.000Z',
              sha256: '4b1e…',
            },
          ],
          nextCursor: '…',
          total: 4,
          limit: 1,
        },
        null,
        2,
      ),
    },
  },
];

/** Signing a script in: the OAuth device flow, exactly as the in-app Developers page shows it. */
export const API_AUTH = {
  title: 'Authentication: each script signs in as a person',
  body: 'There are no shared API keys to paste or leak. A script asks for a short code, you approve it in Pactlab while signed in, and the script gets tokens that act as you: your organization, your pacts, your role’s limits. Web apps use the authorization code flow with PKCE instead.',
  points: [
    { title: 'Scopes', body: 'api:read (the default) reads what you can see. api:write also lets the script upload documents, draft findings and request documents. Ask for write only when the script changes things.' },
    { title: 'Tokens', body: 'Access tokens last an hour. Refresh tokens rotate: use each once and keep the new one. Presenting a used refresh token again ends that sign-in.' },
    { title: 'Revocation', body: 'You can see and disconnect your signed-in scripts in Settings → Connected apps. Organization owners and admins can switch API access off for everyone, which takes effect at once.' },
    { title: 'What stays in the app', body: 'Approvals, sign-offs, billing, members and settings. API calls to those answer 403 NOT_AVAILABLE_TO_API.' },
  ],
  example: `API=${API_ORIGIN}

# 1. Ask for a sign-in code (add "-d scope=api:write" only if the script changes things)
curl -s -X POST $API/v1/oauth/device_authorization -d client_id=my-script

# 2. Open the link it returns while signed in to Pactlab, check the code and approve.

# 3. Swap the device code for tokens (poll every few seconds until you approve)
curl -s -X POST $API/v1/oauth/token \\
  -d grant_type=urn:ietf:params:oauth:grant-type:device_code \\
  -d client_id=my-script -d device_code=DEVICE_CODE

# 4. Call the API as yourself
curl -s $API/v1/deals -H "Authorization: Bearer $ACCESS_TOKEN"`,
} as const;

export const API_CONVENTIONS = [
  {
    title: 'Pages, not dumps',
    body: 'Every list takes cursor and limit (default 50, at most 100) and answers items, nextCursor, total and limit. Pass nextCursor back as cursor until it is null.',
  },
  {
    title: 'Errors you can branch on',
    body: 'Errors are RFC 9457 problem details with a stable code: 401 means sign in again; 403 INSUFFICIENT_SCOPE means ask for api:write; 403 API_DISABLED means your organization switched the API off; 404 means the record does not exist or you may not see it.',
  },
  {
    title: 'Rate limits',
    body: 'Sign-in endpoints are limited per address. Any call may answer 429 as problem details; back off and retry rather than retrying at once.',
  },
  {
    title: 'Versioning',
    body: 'The version is in the path (/v1). New fields and new routes arrive within v1, so ignore fields you do not know. The reference at /v1/openapi.json is generated from the routes the API enforces, so the reference and the API cannot disagree.',
  },
] as const;

export const API_ERROR_EXAMPLE = JSON.stringify(
  { type: 'about:blank', title: 'Forbidden', status: 403, code: 'INSUFFICIENT_SCOPE', requestId: 'req_example' },
  null,
  2,
);

/** The MCP server's tools (apps/api/src/mcp/mcp.service.ts). Reads need mcp:read; suggestions need mcp:propose. */
export const MCP_TOOLS = {
  read: [
    { name: 'list_deals', body: 'The pacts you can see, paged.' },
    { name: 'get_deal_summary', body: 'One pact and its screening verdict (GO / NO_GO) with reasons.' },
    { name: 'get_findings', body: 'Findings with their evidence, rationale and valuation direction.' },
    { name: 'get_claims_register', body: 'Each material claim as VERIFIED, CONTRADICTED or UNVERIFIED, with its linked findings.' },
    { name: 'get_valuation_bridge', body: 'Scenarios with their latest deterministic run and the purchase-price bridge.' },
    { name: 'run_valuation_scenario', body: 'A what-if rerun of one scenario with some assumptions replaced; nothing is saved.' },
    { name: 'search_evidence', body: 'Normalized evidence with its source, to cite.' },
    { name: 'get_post_close_register', body: 'After close: asset-preservation and integration actions, with owners and status.' },
    { name: 'get_foresight', body: 'Five-year forecasts and the projected value range, with the assumptions behind them.' },
  ],
  propose: [
    { name: 'propose_term', body: 'Suggest that an accepted, priced risk go on the draft terms as a lever. The amount is Pactlab’s own; a person approves it.' },
    { name: 'draft_document_requests', body: 'Suggest a request to the other side for missing documents; a person approves it before they see it.' },
    { name: 'list_my_proposals', body: 'What became of your suggestions, with the approver’s note.' },
    { name: 'export_counterparty_view', body: 'Only what the other side may see of the pact.' },
  ],
} as const;

export const API_MCP = {
  title: 'MCP: the same pacts, for AI agents',
  body: 'REST is for your systems; the Model Context Protocol server is for agents such as Claude. It reads the same services as the API, with the same permissions, and adds the views an agent needs to reason about a deal: the claims register, the valuation bridge, the post-close register and Foresight. An agent can suggest a deal term or a document request; a person decides each one in Pactlab.',
  address: `${API_ORIGIN}/v1/mcp`,
  connect: 'In Claude: Settings → Connectors → Add custom connector, then enter the address. Claude opens Pactlab’s sign-in; you check the organization and what it may read, and approve. Other MCP clients discover everything from the same address. An organization admin switches MCP on first.',
} as const;

export const API_CTA = {
  /** The Developers pages in the app walk through signing in a script, with the reference generated from the live API. */
  label: 'Get API access in the app',
  /** The in-app Developers → API page (T-128). Lands there after sign-in. */
  path: '/developers/api',
} as const;
