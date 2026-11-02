'use strict';
/**
 * The wake page (ADR 0019): while an environment is paused, the load balancer
 * sends every request here. GET shows the state; only a POST (the button)
 * starts the wake, so crawlers that only GET never wake an environment. One
 * wake per pause: the execution name carries the power parameter's version.
 *
 * While waking, the page shows which step the wake is on (read from the wake
 * state machine's history), how long it has been running, and an estimate of
 * the minutes left from this environment's recent wakes.
 */

/** Wake state machine states, in order, and the step of the page each belongs to. */
const PHASES = [
  { label: 'Starting the database', states: ['StepStartWake', 'WaitForDatabase', 'StepDatabaseReady', 'DatabaseUp'] },
  { label: 'Starting the app', states: ['StepStartServices'] },
  { label: 'Health checks, then opening the app', states: ['WaitForTargets', 'StepTargetsHealthy', 'Serving', 'StepFinishWake'] },
];
/** Until this environment has woken before: a typical wake takes about 7 minutes. */
const DEFAULT_WAKE_SECONDS = 7 * 60;

const phaseOf = (state) => Math.max(0, PHASES.findIndex((phase) => phase.states.includes(state)));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * What to show while waking. `progress` is `{ startedAt, state, pastSeconds[] }`
 * (from the state machine) or null when no wake is running yet.
 */
function estimate(progress, now) {
  if (!progress) return null;
  const elapsed = Math.max(0, Math.round((now - progress.startedAt) / 1000));
  const typical = progress.pastSeconds.length ? median(progress.pastSeconds) : DEFAULT_WAKE_SECONDS;
  const phase = phaseOf(progress.state);
  // Never promise "0": while the last step runs, say about a minute.
  const leftMinutes = Math.max(1, Math.ceil((typical - elapsed) / 60));
  return { elapsed, phase, leftMinutes, basis: progress.pastSeconds.length ? `the last ${progress.pastSeconds.length} wake${progress.pastSeconds.length === 1 ? '' : 's'}` : 'a typical wake' };
}

const html = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page(envName, state, progress) {
  const waking = state !== 'paused';
  const title = `Pactlab ${html(envName)} is ${waking ? 'waking up' : 'paused'}`;
  let body;
  if (!waking) {
    body = `<p>This environment is paused to save cost while nobody is using it. Wake it up and it is back in about 5 to 8 minutes, with all its data.</p>
<form method="post" action="/__pactlab/wake"><button type="submit">Wake it up</button></form>`;
  } else if (!progress) {
    body = '<p>Waking up: starting… This page refreshes by itself and opens the app when it is ready.</p>';
  } else {
    const steps = PHASES.map((phase, index) => {
      const mark = index < progress.phase ? '✓' : index === progress.phase ? '●' : '○';
      return `<li class="${index === progress.phase ? 'now' : index < progress.phase ? 'done' : ''}">${mark} ${index + 1} of ${PHASES.length}: ${phase.label}</li>`;
    }).join('');
    body = `<p class="left">About <strong>${progress.leftMinutes} minute${progress.leftMinutes === 1 ? '' : 's'}</strong> left <span class="muted">(estimate from ${progress.basis})</span></p>
<ol class="steps">${steps}</ol>
<p class="muted">Running for <span id="elapsed" data-start="${Date.now() - progress.elapsed * 1000}">${Math.floor(progress.elapsed / 60)}:${String(progress.elapsed % 60).padStart(2, '0')}</span>. This page refreshes every 15 seconds and opens the app when it is ready.</p>
<script>(function(){var e=document.getElementById('elapsed');if(!e)return;var s=Number(e.dataset.start);setInterval(function(){var t=Math.max(0,Math.round((Date.now()-s)/1000));e.textContent=Math.floor(t/60)+':'+String(t%60).padStart(2,'0');},1000);})();</script>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">${waking ? '<meta http-equiv="refresh" content="15">' : ''}
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;color:#0b1f3a}button{font:inherit;padding:.7rem 1.4rem;border-radius:.5rem;border:0;background:#0b1f3a;color:#fff;cursor:pointer}p{line-height:1.5}.muted{color:#5b6b80;font-size:.9rem}.steps{list-style:none;padding:0;line-height:2}.steps .now{font-weight:700}.steps .done{color:#5b6b80}.left{font-size:1.15rem}</style></head>
<body><h1>Pactlab ${html(envName)}</h1>${body}</body></html>`;
}

/** The handler with its AWS calls injected, so it can be tested without AWS. */
function makeHandler({ envName, readPower, startWake, readProgress = async () => null, now = () => Date.now() }) {
  return async (event) => {
    const power = await readPower();
    if ((event.httpMethod || '').toUpperCase() === 'POST' && power.value === 'paused') {
      await startWake(`wake-${power.version}`);
      return { statusCode: 303, statusDescription: '303 See Other', headers: { location: '/', 'cache-control': 'no-store' }, body: '', isBase64Encoded: false };
    }
    const state = power.value === 'paused' ? 'paused' : 'waking';
    // Progress is a nicety: if it cannot be read, the page still works.
    const progress = state === 'waking' ? estimate(await readProgress().catch(() => null), now()) : null;
    return {
      statusCode: 503,
      statusDescription: '503 Service Unavailable',
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '15', 'x-robots-tag': 'noindex, nofollow' },
      body: page(envName, state, progress),
      isBase64Encoded: false,
    };
  };
}

let live;
exports.handler = async (event) => {
  if (!live) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const { SFNClient, StartExecutionCommand, ListExecutionsCommand, GetExecutionHistoryCommand } = require('@aws-sdk/client-sfn');
    const ssm = new SSMClient({});
    const sfn = new SFNClient({});
    const machine = process.env.WAKE_STATE_MACHINE_ARN;
    live = makeHandler({
      envName: process.env.ENV_NAME,
      readPower: async () => {
        const { Parameter } = await ssm.send(new GetParameterCommand({ Name: process.env.POWER_PARAMETER }));
        return { value: Parameter.Value, version: Parameter.Version };
      },
      startWake: async (name) => {
        try {
          await sfn.send(new StartExecutionCommand({ stateMachineArn: machine, name, input: '{}' }));
        } catch (error) {
          // A second click for the same pause: the wake is already under way.
          if (error.name !== 'ExecutionAlreadyExists') throw error;
        }
      },
      readProgress: async () => {
        const running = (await sfn.send(new ListExecutionsCommand({ stateMachineArn: machine, statusFilter: 'RUNNING', maxResults: 1 }))).executions?.[0];
        if (!running) return null;
        const history = await sfn.send(new GetExecutionHistoryCommand({ executionArn: running.executionArn, reverseOrder: true, maxResults: 20 }));
        const entered = (history.events || []).find((event) => event.stateEnteredEventDetails);
        const done = (await sfn.send(new ListExecutionsCommand({ stateMachineArn: machine, statusFilter: 'SUCCEEDED', maxResults: 5 }))).executions || [];
        return {
          startedAt: new Date(running.startDate).getTime(),
          state: entered ? entered.stateEnteredEventDetails.name : 'StepStartWake',
          pastSeconds: done.filter((execution) => execution.stopDate).map((execution) => (new Date(execution.stopDate) - new Date(execution.startDate)) / 1000),
        };
      },
    });
  }
  return live(event);
};
exports.makeHandler = makeHandler;
exports.estimate = estimate;
exports.PHASES = PHASES;
