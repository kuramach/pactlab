import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import { oauthOrigins } from '../../../../lib/oauth-metadata';
import { apiGet } from '../../deals/_lib/api';
import { Code, type DeveloperAccess, Step } from '../_lib/code';
import { Reference, type OpenApiSpec } from './reference';

export const dynamic = 'force-dynamic';

const DEVICE = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * Developers → API (T-128): how to sign your own script in to the Pactlab API as yourself, and
 * the reference generated from the API's own route schemas (`/v1/openapi.json`).
 */
export default async function ApiDevelopersPage() {
  const { api, issuer } = oauthOrigins();
  const [access, spec] = await Promise.all([apiGet<DeveloperAccess>('/v1/me/developer-access'), apiGet<OpenApiSpec>('/v1/openapi.json')]);
  const state = access.kind === 'ok' ? access.data : null;
  const curl = `API=${api}

# 1. Ask for a sign-in code (use a name for your script; add "-d scope=api:write" only if it changes things)
curl -s -X POST $API/v1/oauth/device_authorization -d client_id=my-script

# → {"device_code":"…","user_code":"BCDF-GHJK","verification_uri":"${issuer}/device","interval":5,…}
# 2. Open ${issuer}/device, check the code and approve.

# 3. Swap the device code for tokens (poll every 5 seconds until you approve)
curl -s -X POST $API/v1/oauth/token \\
  -d grant_type=${DEVICE} \\
  -d client_id=my-script -d device_code=DEVICE_CODE

# 4. Call the API as yourself
curl -s $API/v1/deals -H "Authorization: Bearer $ACCESS_TOKEN"`;
  const python = `import time, requests

API = "${api}"
CLIENT = "my-script"

start = requests.post(f"{API}/v1/oauth/device_authorization", data={"client_id": CLIENT}).json()
print(f"Open {start['verification_uri_complete']} and approve code {start['user_code']}")

while True:
    time.sleep(start["interval"])
    reply = requests.post(f"{API}/v1/oauth/token", data={
        "grant_type": "${DEVICE}",
        "client_id": CLIENT,
        "device_code": start["device_code"],
    }).json()
    if "access_token" in reply:
        break
    if reply.get("error") not in ("authorization_pending", "slow_down"):
        raise SystemExit(reply.get("error_description"))

headers = {"Authorization": f"Bearer {reply['access_token']}"}
cursor = None
while True:  # every pact you can see, a page at a time
    page = requests.get(f"{API}/v1/deals", headers=headers, params={"limit": 100, **({"cursor": cursor} if cursor else {})}).json()
    for deal in page["items"]:
        print(deal["name"])
    cursor = page["nextCursor"]
    if not cursor:
        break`;
  const refresh = `# Access tokens last an hour. Refresh tokens rotate: use each once, keep the new one.
curl -s -X POST $API/v1/oauth/token \\
  -d grant_type=refresh_token -d client_id=my-script -d refresh_token=REFRESH_TOKEN`;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { label: 'Developers' }, { label: 'API' }]}
        title="Pactlab API"
        description="Use Pactlab from your own scripts and tools. You sign each one in as yourself, so it sees only what you can see, and every call is in the audit log under your name. There are no shared keys to paste or leak."
      />

      {state && !state.pactlabSignIn ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          API sign-in is available for organizations that sign in with Pactlab (email code or passkey). Company single sign-on is not supported yet.
        </p>
      ) : state && !state.apiEnabled ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          API access is switched off for your organization. An owner or admin can turn it on in Settings → API access.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Getting started</CardTitle>
          <CardDescription>
            Scripts sign in with a short code you approve here (the OAuth device flow). Nothing secret is ever copied out of Pactlab.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Step n={1} title="Sign your script in">
            <p>
              Your script asks for a code, then shows you a link and an eight-letter code. Open the link while signed in, check the code matches, and approve. Ask for{' '}
              <code>api:read</code> (the default) unless the script needs to change things; then add <code>scope=api:write</code>.
            </p>
            <Code label="Terminal (curl)">{curl}</Code>
          </Step>
          <Step n={2} title="Call the API">
            <p>
              Send the access token as <code>Authorization: Bearer …</code>. Lists come a page at a time: <code>items</code>, <code>nextCursor</code>, <code>total</code>{' '}
              and <code>limit</code> (default 50, at most 100). Pass <code>nextCursor</code> back as <code>cursor</code> until it is null.
            </p>
            <Code label="Python (requests)">{python}</Code>
          </Step>
          <Step n={3} title="Keep it signed in">
            <Code label="Refresh">{refresh}</Code>
            <p>
              Store tokens like passwords. If a used refresh token is ever presented again, Pactlab ends that sign-in, so a copied token stops working.
            </p>
          </Step>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What the API will and won’t do</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              <strong>Will:</strong> read your pacts, documents, findings, evidence, valuation and reports, with your role’s limits. With <code>api:write</code>: upload
              documents, draft findings and request documents, as you.
            </p>
            <p>
              <strong>Won’t:</strong> approve or sign anything off, change billing, members or settings. Those stay in the app, with a person. Calls to them return 403{' '}
              <code>NOT_AVAILABLE_TO_API</code>.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Errors and access</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              Errors are RFC 9457 problem details with a stable <code>code</code>: 401 means sign in again, 403 <code>INSUFFICIENT_SCOPE</code> means ask for{' '}
              <code>api:write</code>, 403 <code>API_DISABLED</code> means your organization turned the API off.
            </p>
            <p>
              See and remove your signed-in scripts in{' '}
              <a href="/settings#connected-apps" className="font-medium text-indigo-ink underline">
                Settings → Connected apps
              </a>
              . Apps with a web sign-in use the authorization code flow with PKCE and <code>resource={api}/v1</code>.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reference</CardTitle>
          <CardDescription>
            Every endpoint open to the API, generated from the checks the API itself runs.{' '}
            <a href={`${api}/v1/openapi.json`} className="font-medium text-indigo-ink underline">
              Download the OpenAPI 3.1 file
            </a>{' '}
            for code generators and API tools.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {spec.kind === 'ok' ? <Reference spec={spec.data} /> : <p className="text-sm text-muted-foreground">The reference could not be loaded. Try again in a moment.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
