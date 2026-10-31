'use strict';
/**
 * The wake page (ADR 0019): while an environment is paused, the load balancer
 * sends every request here. GET shows the state; only a POST (the button)
 * starts the wake, so crawlers that only GET never wake an environment. One
 * wake per pause: the execution name carries the power parameter's version.
 */

const page = (envName, state) => {
  const waking = state !== 'paused';
  const message = waking
    ? 'Waking up. This takes about 5 to 8 minutes; this page refreshes by itself and opens the app when it is ready.'
    : 'This environment is paused to save cost while nobody is using it. Wake it up and it is back in about 5 to 8 minutes, with all its data.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">${waking ? '<meta http-equiv="refresh" content="20">' : ''}
<title>Pactlab ${envName} is ${waking ? 'waking up' : 'paused'}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#0b1f3a}button{font:inherit;padding:.7rem 1.4rem;border-radius:.5rem;border:0;background:#0b1f3a;color:#fff;cursor:pointer}p{line-height:1.5}</style></head>
<body><h1>Pactlab ${envName}</h1><p>${message}</p>
${waking ? '' : '<form method="post" action="/__pactlab/wake"><button type="submit">Wake it up</button></form>'}
</body></html>`;
};

/** The handler with its AWS calls injected, so it can be tested without AWS. */
function makeHandler({ envName, readPower, startWake }) {
  return async (event) => {
    const power = await readPower();
    if ((event.httpMethod || '').toUpperCase() === 'POST' && power.value === 'paused') {
      await startWake(`wake-${power.version}`);
      return { statusCode: 303, statusDescription: '303 See Other', headers: { location: '/', 'cache-control': 'no-store' }, body: '', isBase64Encoded: false };
    }
    return {
      statusCode: 503,
      statusDescription: '503 Service Unavailable',
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60', 'x-robots-tag': 'noindex, nofollow' },
      body: page(envName, power.value === 'paused' ? 'paused' : 'waking'),
      isBase64Encoded: false,
    };
  };
}

let live;
exports.handler = async (event) => {
  if (!live) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
    const ssm = new SSMClient({});
    const sfn = new SFNClient({});
    live = makeHandler({
      envName: process.env.ENV_NAME,
      readPower: async () => {
        const { Parameter } = await ssm.send(new GetParameterCommand({ Name: process.env.POWER_PARAMETER }));
        return { value: Parameter.Value, version: Parameter.Version };
      },
      startWake: async (name) => {
        try {
          await sfn.send(new StartExecutionCommand({ stateMachineArn: process.env.WAKE_STATE_MACHINE_ARN, name, input: '{}' }));
        } catch (error) {
          // A second click for the same pause: the wake is already under way.
          if (error.name !== 'ExecutionAlreadyExists') throw error;
        }
      },
    });
  }
  return live(event);
};
exports.makeHandler = makeHandler;
