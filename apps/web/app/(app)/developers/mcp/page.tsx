import type { ConnectedAppView } from '@pactlab/contracts';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import { oauthOrigins } from '../../../../lib/oauth-metadata';
import { apiGet } from '../../deals/_lib/api';
import { Code, type DeveloperAccess, Step } from '../_lib/code';

export const dynamic = 'force-dynamic';

const SCOPES = [
  { scope: 'mcp:read', words: 'Read your pacts: findings, claims, valuation, Foresight and evidence, with citations. Always included.' },
  { scope: 'mcp:confidential', words: 'Also confidential material your role already allows (the confirmed-value ledger, founder-confidential findings).' },
  { scope: 'mcp:propose', words: 'Suggest terms and document requests. They wait on the pact for a person to approve; Claude never approves, sends or changes anything.' },
];
const PROMPTS = [
  { title: 'Screen this deal', words: 'A GO / NO_GO read from the screening, findings and claims.' },
  { title: 'Prep me for IC', words: 'Findings, the valuation bridge and open claims, in order of materiality.' },
  { title: 'What will the investor find?', words: 'Venture Raise self-diligence: the risks an investor will discover, in the order they would.' },
];
const QUESTIONS = [
  'Which of my pacts have open high-severity findings?',
  'Summarise the claims register for this pact: what is contradicted, and by which evidence?',
  'Walk me through the valuation bridge and the assumptions behind the biggest adjustment.',
  'What documents are we still waiting on from the seller?',
];

/** Developers → Use with Claude (T-128): connect Claude to Pactlab's MCP server, as yourself. */
export default async function McpDevelopersPage() {
  const { resource } = oauthOrigins();
  const [access, apps] = await Promise.all([apiGet<DeveloperAccess>('/v1/me/developer-access'), apiGet<{ apps: ConnectedAppView[] }>('/v1/me/connected-apps')]);
  const state = access.kind === 'ok' ? access.data : null;
  const connected = apps.kind === 'ok' ? apps.data.apps.filter((app) => app.scopes.some((scope) => scope.startsWith('mcp:'))) : [];

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { label: 'Developers' }, { label: 'Use with Claude' }]}
        title="Use Pactlab with Claude"
        description="Ask Claude about your pacts, with answers grounded in Pactlab’s findings, evidence and valuation and cited back to the source. Claude signs in as you and sees only what you can see."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Your organization{' '}
            {state ? <Badge variant={state.mcpEnabled && state.pactlabSignIn ? 'calculation' : 'neutral'}>{state.mcpEnabled && state.pactlabSignIn ? 'Ready to connect' : 'Not available yet'}</Badge> : null}
          </CardTitle>
          <CardDescription>
            {!state
              ? 'Couldn’t check right now.'
              : !state.pactlabSignIn
                ? 'Connecting Claude is available for organizations that sign in with Pactlab (email code or passkey). Company single sign-on is not supported yet.'
                : state.mcpEnabled
                  ? 'Connecting AI apps is switched on for your organization.'
                  : 'Connecting AI apps isn’t switched on for your organization yet. Ask Pactlab to turn it on.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connected.length === 0 ? (
            <p className="text-sm text-muted-foreground">You haven’t connected Claude yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" aria-label="Your connected AI apps">
              {connected.map((app) => (
                <li key={app.id}>
                  <strong>{app.clientName}</strong> · {app.organizationName} · {app.lastUsedAt ? `last used ${app.lastUsedAt.slice(0, 10)}` : 'not used yet'}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect Claude</CardTitle>
          <CardDescription>Pactlab is a remote MCP server. You add it once, then sign in to Pactlab from Claude.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Step n={1} title="Add Pactlab as a connector">
            <p>
              In Claude (web or desktop), open <strong>Settings → Connectors</strong>, choose <strong>Add custom connector</strong>, name it Pactlab and paste this
              address:
            </p>
            <Code label="Connector URL">{resource}</Code>
          </Step>
          <Step n={2} title="Sign in and approve">
            <p>
              Choose <strong>Connect</strong>. Claude opens Pactlab: sign in, check the organization, and approve what Claude may do. You choose from these
              permissions:
            </p>
            <ul className="flex flex-col gap-2">
              {SCOPES.map((entry) => (
                <li key={entry.scope} className="flex gap-2">
                  <Badge variant="neutral" className="shrink-0 font-mono">
                    {entry.scope}
                  </Badge>
                  <span>{entry.words}</span>
                </li>
              ))}
            </ul>
          </Step>
          <Step n={3} title="Or use Claude Code">
            <Code label="Terminal">{`claude mcp add --transport http pactlab ${resource}`}</Code>
            <p>
              Then run <code>/mcp</code> in Claude Code and choose Pactlab to sign in.
            </p>
          </Step>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What you can ask</CardTitle>
            <CardDescription>Built-in prompts appear in Claude’s prompt menu once connected.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <ul className="flex flex-col gap-2">
              {PROMPTS.map((prompt) => (
                <li key={prompt.title}>
                  <strong>{prompt.title}</strong>: {prompt.words}
                </li>
              ))}
            </ul>
            <p className="font-medium">Or just ask, for example:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {QUESTIONS.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suggestions stay suggestions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              With <code>mcp:propose</code>, Claude can suggest a deal term or a document request. Each one lands on the pact as a suggestion; a person reviews and approves it
              in Pactlab. Claude never approves, sends or prices anything itself.
            </p>
            <p>Every call Claude makes is in your organization’s audit log under your name.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disconnecting and troubleshooting</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            <strong>Disconnect</strong> any time in{' '}
            <a href="/settings#connected-apps" className="font-medium text-indigo-ink underline">
              Settings → Connected apps
            </a>
            ; Claude’s access stops at once.
          </p>
          <p>
            <strong>“Not switched on”:</strong> connecting AI apps is turned on per organization by Pactlab. Ask us.
          </p>
          <p>
            <strong>Claude says it lost access:</strong> you disconnected it, left the organization, or it was switched off. Connect again from Claude’s connector settings.
          </p>
          <p>
            <strong>Several organizations:</strong> Claude connects to the one you choose when signing in. Connect again to use another.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
