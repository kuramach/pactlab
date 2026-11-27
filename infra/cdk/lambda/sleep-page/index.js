'use strict';
/**
 * The sleep page (ADR 0063): what app.<env>.pactlab.ai shows while the environment is hibernated,
 * and its Wake up button. CloudFront serves it from this function's URL; the app's DNS name points
 * here while asleep and back at the load balancer once awake.
 *
 * The button is a POST, so crawlers that only GET never wake anything, and it starts at most one
 * wake per hibernation: it moves the power state to `rebuilding` before dispatching the
 * `env-power` workflow (action `wake`), and a second press sees `rebuilding` and shows progress.
 * Waking needs no approval (Kumar, 2026-11-27). Progress is read from that workflow's latest run.
 */
const WORKFLOW = 'env-power.yml';
const ABOUT = 'about 30–40 minutes';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(env, { title, body, refresh }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${escapeHtml(title)} · Pactlab ${escapeHtml(env)}</title>
<style>body{font-family:Manrope,system-ui,sans-serif;background:#f6f7fb;color:#0f1b3d;margin:0;display:grid;place-items:center;min-height:100vh}
main{max-width:34rem;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(15,27,61,.12)}h1{font-size:1.25rem;margin:0 0 .75rem}
p{line-height:1.5;margin:.5rem 0}button{font:inherit;font-weight:600;background:#3b4fd8;color:#fff;border:0;border-radius:8px;padding:.6rem 1.2rem;cursor:pointer}
.muted{color:#5b6585;font-size:.9rem}a{color:#3b4fd8}</style></head><body><main>${body}</main></body></html>`;
}

function makeHandler(deps) {
  const env = deps.env.ENV_NAME;
  const respond = (statusCode, html, extra = {}) => ({
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      ...extra,
    },
    body: html,
  });

  async function wake() {
    const power = await deps.getPower();
    if (power !== 'hibernated') return { statusCode: 303, headers: { location: '/', 'cache-control': 'no-store' }, body: '' };
    const token = await deps.githubToken();
    if (!token || token === 'unset') {
      return respond(
        503,
        page(env, {
          title: 'Wake it from GitHub',
          body: `<h1>This button isn’t set up yet</h1><p>The environment can still be woken: run <code>scripts/env-wake.sh ${escapeHtml(env)}</code>, or the <strong>env-power</strong> workflow with <em>wake</em>.</p>`,
        }),
      );
    }
    // Claim the wake first: a second press (or a crawler's) sees `rebuilding` and starts nothing.
    await deps.setPower('rebuilding');
    try {
      await deps.dispatch(token, { ref: 'main', inputs: { environment: env, action: 'wake' } });
    } catch (error) {
      await deps.setPower('hibernated');
      deps.log({ message: 'wake dispatch failed', errorClass: error && error.name });
      return respond(502, page(env, { title: 'Could not start the wake', body: '<h1>Could not start the wake</h1><p>GitHub did not accept the request. Nothing changed; try again in a minute.</p><form method="post" action="/wake"><button>Try again</button></form>' }));
    }
    return { statusCode: 303, headers: { location: '/', 'cache-control': 'no-store' }, body: '' };
  }

  async function show() {
    const power = await deps.getPower();
    if (power === 'hibernated') {
      return respond(
        200,
        page(env, {
          title: 'Asleep',
          body: `<h1>This environment is asleep</h1><p>Pactlab ${escapeHtml(env)} sleeps when nobody uses it, so it costs almost nothing. Its data is kept.</p><p>It takes ${ABOUT} to wake.</p><form method="post" action="/wake"><button>Wake it up</button></form>`,
        }),
      );
    }
    if (power === 'rebuilding') {
      const run = await deps.githubToken().then((token) => (token && token !== 'unset' ? deps.latestRun(token) : null)).catch(() => null);
      const minutes = run && run.startedAt ? Math.max(0, Math.round((deps.now() - run.startedAt) / 60000)) : null;
      return respond(
        200,
        page(env, {
          title: 'Waking',
          refresh: 30,
          body: `<h1>Waking up</h1><p>It takes ${ABOUT}. This page checks again every 30 seconds.</p>${
            run ? `<p class="muted">${minutes !== null ? `Started ${minutes} minute${minutes === 1 ? '' : 's'} ago. ` : ''}${run.step ? `Now: ${escapeHtml(run.step)}.` : ''}</p>` : ''
          }`,
        }),
      );
    }
    if (power === 'hibernating') {
      return respond(200, page(env, { title: 'Going to sleep', refresh: 60, body: '<h1>Going to sleep</h1><p>The environment is being put to sleep. Once it is asleep, this page offers the Wake up button.</p>' }));
    }
    // Awake (or paused): the app answers once DNS has moved back to it, within about a minute.
    return respond(200, page(env, { title: 'Awake', refresh: 30, body: `<h1>It’s awake</h1><p>The app is back; this name points to it again within a minute or so.</p><p><a href="/login">Open Pactlab ${escapeHtml(env)}</a></p>` }));
  }

  return async (event) => {
    const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || event.httpMethod || 'GET';
    const path = event.rawPath || event.path || '/';
    if (method === 'POST' && path === '/wake') return wake();
    if (method !== 'GET' && method !== 'HEAD') return respond(405, page(env, { title: 'Not allowed', body: '<h1>Not allowed</h1>' }), { allow: 'GET, HEAD, POST' });
    return show();
  };
}

function live() {
  const { SSMClient, GetParameterCommand, PutParameterCommand } = require('@aws-sdk/client-ssm');
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const ssm = new SSMClient({});
  const secrets = new SecretsManagerClient({});
  const env = process.env;
  const github = async (token, path, init = {}) => {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
      ...init,
      redirect: 'manual',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'pactlab-sleep-page', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (!response.ok) {
      const error = new Error(`GitHub answered ${response.status}`);
      error.name = 'GitHubError';
      throw error;
    }
    return response.status === 204 ? null : response.json();
  };
  const githubToken = async () => (await secrets.send(new GetSecretValueCommand({ SecretId: env.GITHUB_TOKEN_SECRET }))).SecretString;
  return {
    env,
    now: () => Date.now(),
    // eslint-disable-next-line no-console -- the function's log is CloudWatch.
    log: (entry) => console.log(JSON.stringify(entry)),
    getPower: async () => (await ssm.send(new GetParameterCommand({ Name: env.POWER_PARAMETER }))).Parameter.Value,
    setPower: (value) => ssm.send(new PutParameterCommand({ Name: env.POWER_PARAMETER, Value: value, Overwrite: true })),
    githubToken,
    dispatch: (token, body) => github(token, `/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify(body) }),
    latestRun: async (token) => {
      const runs = await github(token, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=1`);
      const run = runs && runs.workflow_runs && runs.workflow_runs[0];
      if (!run) return null;
      const jobs = await github(token, `/actions/runs/${run.id}/jobs`);
      const steps = (jobs && jobs.jobs && jobs.jobs[0] && jobs.jobs[0].steps) || [];
      const current = steps.find((step) => step.status === 'in_progress');
      return { startedAt: Date.parse(run.run_started_at || run.created_at), step: current ? current.name : null };
    },
  };
}

let handler;
exports.handler = (event) => {
  handler = handler || makeHandler(live());
  return handler(event);
};
exports.makeHandler = makeHandler;
