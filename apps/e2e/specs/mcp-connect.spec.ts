import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_ORIGIN, REPO, serverEnv } from '../support/env';
import { LEAD } from '../support/login';

const REDIRECT = 'http://127.0.0.1:47321/callback';
const RESOURCE = `${API_ORIGIN}/v1/mcp`;

/**
 * T-084: an AI app connects to Pactlab. The operator switches MCP on for the organization;
 * the app registers and sends the person to the consent page; approving returns a code
 * (with state and iss) that buys tokens; the person sees and disconnects it in Settings.
 */
test('connect an MCP client: consent, tokens, then disconnect in Settings', { tag: '@regression' }, async ({ page, context }) => {
  const operator = spawnSync('pnpm', ['--silent', 'ops:operator', LEAD], { cwd: REPO, env: serverEnv(), encoding: 'utf8' });
  expect(operator.status, operator.stderr).toBe(0);

  // Discovery: the MCP server advertises its authorization server.
  const unauthenticated = await fetch(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get('www-authenticate')).toContain('resource_metadata=');
  const metadata = (await (await page.request.get('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
  expect(metadata).toMatchObject({ code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true });

  // The operator turns MCP on for Charlie.
  await page.goto('/admin?tab=organizations');
  const mcp = page.getByRole('form', { name: 'MCP for Charlie Advisory (synthetic)' });
  // Off or already on: wait until the form shows which, then turn it on if needed.
  const turnOn = mcp.getByRole('button', { name: 'Turn on' });
  await expect(turnOn.or(mcp.getByText('MCP on'))).toBeVisible();
  if ((await turnOn.count()) > 0) await turnOn.click();
  await expect(page.getByRole('form', { name: 'MCP for Charlie Advisory (synthetic)' }).getByText('MCP on')).toBeVisible();

  const registered = (await (await fetch(`${API_ORIGIN}/v1/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'E2E desktop app', redirect_uris: [REDIRECT] }) })).json()) as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE, state: 'e2e-state' });

  // The app's callback (nothing listens there in the test): answer it, keep its URL.
  await context.route(`${REDIRECT}**`, (route) => route.fulfill({ status: 200, body: 'connected' }));
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page.getByRole('heading', { name: /Connect E2E desktop app to Pactlab\?/ })).toBeVisible();
  await expect(page.getByText('mcp:read')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.waitForURL(/127\.0\.0\.1:47321\/callback/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe('e2e-state');
  expect(callback.searchParams.get('iss')).toBeTruthy();

  const tokens = await fetch(`${API_ORIGIN}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: callback.searchParams.get('code') ?? '', client_id: registered.client_id, redirect_uri: REDIRECT, code_verifier: verifier, resource: RESOURCE }),
  });
  expect(tokens.status).toBe(200);
  const { access_token: accessToken } = (await tokens.json()) as { access_token: string };
  expect((await fetch(RESOURCE, { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } })).status).toBe(405);

  // Settings → Connected apps: listed, then disconnected; the token stops working.
  await page.goto('/settings#connected-apps');
  const card = page.locator('#connected-apps');
  await expect(card).toContainText('E2E desktop app');
  await card.getByRole('button', { name: 'Disconnect E2E desktop app' }).click();
  await expect(card).not.toContainText('E2E desktop app');
  const after = await fetch(RESOURCE, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect(after.status).toBe(401);

  // Leave MCP off, as it ships.
  await page.goto('/admin?tab=organizations');
  await page.getByRole('form', { name: 'MCP for Charlie Advisory (synthetic)' }).getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('form', { name: 'MCP for Charlie Advisory (synthetic)' }).getByText('MCP off')).toBeVisible();
});
