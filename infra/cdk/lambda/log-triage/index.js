'use strict';
/**
 * Live log triage (T-150, ADR 0048): once a day in the live account, sweep the
 * app's logs since the last successful run, cluster the errors, ask Bedrock for
 * a verdict on each reportable cluster, open or update one GitHub issue per bug
 * worth a look, and email one digest. Nothing reportable: no email.
 *
 * DRY_RUN (or an event `{ "dryRun": true }`) runs the queries and the triage but
 * sends nothing, opens nothing and stores nothing: the digest and the issue
 * bodies go to this function's log instead.
 *
 * Every AWS and network call is injected (makeRun), so the flow is tested
 * without AWS; `live()` builds the real ones from the runtime's SDK.
 */
const triage = require('./triage');

const QUERY_POLL_MS = 2000;
const QUERY_DEADLINE_MS = 8 * 60_000;
const DEPLOY_LOOKBACK_MS = 14 * 24 * 3600_000;
const WATERMARK_KEY = 'WATERMARK';

/** One run. `deps` holds the side effects; `env` the function's configuration. */
function makeRun(deps, env) {
  const logGroups = JSON.parse(env.LOG_GROUPS);
  const maxClusters = Number(env.MAX_CLUSTERS || triage.DEFAULT_MAX_CLUSTERS);
  const options = { operatorEmail: env.RECIPIENT };
  // eslint-disable-next-line no-console -- the Lambda's log is CloudWatch; a dry run's drafts are read there.
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));

  async function runQuery(spec, groups, window) {
    const queryId = await deps.logs.startQuery({ logGroupNames: groups, startTime: window.start, endTime: window.end, queryString: spec.query, limit: triage.QUERY_LIMIT });
    const started = deps.now();
    for (;;) {
      const result = await deps.logs.getQueryResults(queryId);
      if (result.status === 'Complete') return result.results ?? [];
      if (['Failed', 'Cancelled', 'Timeout', 'Unknown'].includes(result.status)) throw new Error(`Logs Insights query for ${spec.kind} ended ${result.status}`);
      if (deps.now() - started > QUERY_DEADLINE_MS) throw new Error(`Logs Insights query for ${spec.kind} took too long`);
      await deps.sleep(QUERY_POLL_MS);
    }
  }

  return async function run(event = {}) {
    const dryRun = env.DRY_RUN === 'true' || event?.dryRun === true;
    const nowMs = deps.now();
    const watermark = await deps.state.getWatermark();
    const window = triage.sweepWindow(watermark, nowMs);

    // Inventory: only the configured live groups that exist; a missing one is said, not skipped silently.
    const existing = new Set(
      await deps.logs.listLogGroups().catch((error) => {
        log({ level: 'warn', message: 'log group inventory unavailable; querying the configured groups', errorName: error?.name });
        return logGroups;
      }),
    );
    const groups = logGroups.filter((name) => existing.has(name));
    const missing = logGroups.filter((name) => !existing.has(name));
    if (missing.length) log({ level: 'warn', message: 'log groups not found', missing });
    if (!groups.length) throw new Error('None of the configured log groups exist');

    const resultsByKind = {};
    const truncated = [];
    const results = await Promise.all(triage.QUERIES.map((spec) => runQuery(spec, groups, window)));
    triage.QUERIES.forEach((spec, index) => {
      resultsByKind[spec.kind] = results[index];
      if (results[index].length >= triage.QUERY_LIMIT) truncated.push(spec.label);
    });

    const clusters = triage.cluster(resultsByKind, options);
    const states = await deps.state.getStates(clusters.map((c) => c.signature));
    const assessed = clusters.map((c) => {
      const state = states[c.signature] ?? null;
      const assessment = triage.reportability(c, state);
      // An issue that could not be opened last time is retried, whatever the counts.
      const pending = state?.status === 'pending_issue';
      return { ...c, ...assessment, reportable: assessment.reportable || pending, everFirstSeen: state?.firstSeen ?? c.firstSeen, state };
    });
    const reportable = triage.rank(assessed.filter((c) => c.reportable));
    const selected = reportable.slice(0, maxClusters);
    const deferred = reportable.length - selected.length;
    log({ message: 'sweep', window, dryRun, groups, clusters: clusters.length, reportable: reportable.length, deferred });

    const deploys = selected.length ? await deps.ecs.recentDeploys(nowMs - DEPLOY_LOOKBACK_MS).catch((error) => {
      log({ level: 'warn', message: 'deploy history unavailable', errorName: error?.name });
      return [];
    }) : [];

    const triaged = [];
    for (const item of selected) {
      let response = null;
      try {
        response = await deps.bedrock.converse(triage.triageRequest(item, deploys, env.MODEL_ID));
      } catch (error) {
        log({ level: 'warn', message: 'triage call failed', signature: item.signature, errorName: error?.name });
      }
      triaged.push({ ...item, ...triage.parseVerdict(response, item, options) });
    }

    // Issues for what a person should look at; never for noise.
    const context = { window, logGroups: groups, dryRun, truncated, deferred, maxClusters };
    // Read even in a dry run, so its draft can say which issues it would comment on instead of opening.
    const token = await deps.github.token();
    const open = token ? await deps.github.openIssues(token).catch((error) => {
      log({ level: 'warn', message: 'could not list open issues', errorName: error?.name });
      return null;
    }) : null;
    const bySignature = new Map((open ?? []).map((issue) => [triage.signatureFromBody(issue.body), issue]).filter(([sig]) => sig));
    for (const item of triaged) {
      if (item.verdict === 'likely_noise') continue;
      const existingIssue = bySignature.get(item.signature);
      if (dryRun) {
        item.issueUrl = existingIssue ? `${existingIssue.html_url} (would comment)` : '(would open a new issue)';
        log({ message: 'dry run: issue', action: existingIssue ? 'comment' : 'open', issue: existingIssue?.number ?? null, title: triage.issueTitle(item), body: existingIssue ? triage.issueComment(item, context) : triage.issueBody(item, context) });
        continue;
      }
      if (!token || open === null) {
        item.issueFailed = true;
        item.issueUrl = token ? 'not opened (GitHub unavailable; retried next run)' : 'not opened (GitHub token not set; retried once it is)';
        continue;
      }
      try {
        if (existingIssue) {
          await deps.github.comment(token, existingIssue.number, triage.issueComment(item, context));
          item.issueNumber = existingIssue.number;
          item.issueUrl = existingIssue.html_url;
        } else {
          const created = await deps.github.createIssue(token, { title: triage.issueTitle(item), body: triage.issueBody(item, context), labels: ['live-triage'] });
          item.issueNumber = created.number;
          item.issueUrl = created.html_url;
        }
      } catch (error) {
        log({ level: 'warn', message: 'issue write failed', signature: item.signature, errorName: error?.name, status: error?.status });
        item.issueFailed = true;
        item.issueUrl = 'not opened (GitHub refused; retried next run)';
      }
    }

    const digest = triage.renderDigest(triaged, context);
    if (dryRun) {
      log({ message: 'dry run: digest', subject: digest?.subject ?? null, text: digest?.text ?? 'Nothing reportable: no email would be sent.' });
      return { dryRun: true, clusters: clusters.length, reportable: reportable.length, triaged: triaged.length };
    }
    if (digest) await deps.ses.send(digest);

    // Only after the digest went out: the state, then the watermark (a failed run sweeps its window again).
    const byTriaged = new Map(triaged.map((item) => [item.signature, item]));
    await deps.state.putStates(
      assessed.map((c) => {
        const item = byTriaged.get(c.signature);
        const outcome = item ? { verdict: item.issueFailed ? 'pending_issue' : item.verdict, issueNumber: item.issueNumber, headline: item.headline } : null;
        return triage.nextState(c, c.state, outcome, nowMs);
      }),
    );
    await deps.state.putWatermark(window.end * 1000);
    return { dryRun: false, clusters: clusters.length, reportable: reportable.length, triaged: triaged.length, emailed: Boolean(digest) };
  };
}

// --- The real dependencies ----------------------------------------------------------------------

function githubClient(repo, fetchImpl = fetch) {
  const call = async (token, method, path, body) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pactlab-live-triage',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      // Never the response body: it may echo what was sent.
      const error = new Error(`GitHub ${method} ${path.split('?')[0]} answered ${response.status}`);
      error.name = 'GitHubError';
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  return {
    /** Open live-triage issues (not pull requests), at most 1,000. */
    async openIssues(token) {
      const issues = [];
      for (let page = 1; page <= 10; page += 1) {
        const batch = await call(token, 'GET', `/issues?state=open&labels=live-triage&per_page=100&page=${page}`);
        issues.push(...batch.filter((issue) => !issue.pull_request));
        if (batch.length < 100) break;
      }
      return issues;
    },
    createIssue: (token, issue) => call(token, 'POST', '/issues', issue),
    comment: (token, number, body) => call(token, 'POST', `/issues/${number}/comments`, { body }),
  };
}

function live(env) {
  const { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
  const { DynamoDBClient, BatchGetItemCommand, BatchWriteItemCommand, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
  const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
  const { ECSClient, ListServiceDeploymentsCommand, DescribeServicesCommand } = require('@aws-sdk/client-ecs');
  const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
  const logs = new CloudWatchLogsClient({});
  const dynamo = new DynamoDBClient({});
  const bedrock = new BedrockRuntimeClient({});
  const ecs = new ECSClient({});
  const ses = new SESv2Client({});
  const secrets = new SecretsManagerClient({});
  const table = env.TABLE;
  const services = JSON.parse(env.SERVICES);
  const github = githubClient(env.GITHUB_REPO);
  const prefix = env.LOG_GROUP_PREFIX;

  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logs: {
      async listLogGroups() {
        const names = [];
        let nextToken;
        do {
          const page = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, nextToken }));
          names.push(...(page.logGroups ?? []).map((group) => group.logGroupName));
          nextToken = page.nextToken;
        } while (nextToken);
        return names;
      },
      async startQuery(input) {
        return (await logs.send(new StartQueryCommand(input))).queryId;
      },
      async getQueryResults(queryId) {
        return logs.send(new GetQueryResultsCommand({ queryId }));
      },
    },
    state: {
      async getWatermark() {
        const item = (await dynamo.send(new GetItemCommand({ TableName: table, Key: marshall({ pk: WATERMARK_KEY }) }))).Item;
        return item ? Number(unmarshall(item).at) : null;
      },
      async putWatermark(at) {
        await dynamo.send(new PutItemCommand({ TableName: table, Item: marshall({ pk: WATERMARK_KEY, at }) }));
      },
      async getStates(signatures) {
        const out = {};
        for (let i = 0; i < signatures.length; i += 100) {
          let keys = signatures.slice(i, i + 100).map((sig) => marshall({ pk: `SIG#${sig}` }));
          for (let attempt = 0; keys.length && attempt < 5; attempt += 1) {
            const page = await dynamo.send(new BatchGetItemCommand({ RequestItems: { [table]: { Keys: keys } } }));
            for (const item of page.Responses?.[table] ?? []) {
              const state = unmarshall(item);
              out[state.signature] = state;
            }
            keys = page.UnprocessedKeys?.[table]?.Keys ?? [];
          }
        }
        return out;
      },
      async putStates(items) {
        for (let i = 0; i < items.length; i += 25) {
          let requests = items.slice(i, i + 25).map((item) => ({ PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) } }));
          for (let attempt = 0; requests.length && attempt < 5; attempt += 1) {
            const page = await dynamo.send(new BatchWriteItemCommand({ RequestItems: { [table]: requests } }));
            requests = page.UnprocessedItems?.[table] ?? [];
          }
        }
      },
    },
    bedrock: { converse: (request) => bedrock.send(new ConverseCommand(request)) },
    ecs: {
      /** Deploy start times per service: the deployment history, else the deployments the service still lists. */
      async recentDeploys(sinceMs) {
        const deploys = [];
        for (const service of services) {
          try {
            const page = await ecs.send(new ListServiceDeploymentsCommand({ cluster: env.CLUSTER, service, createdAt: { after: new Date(sinceMs) } }));
            for (const d of page.serviceDeployments ?? []) deploys.push({ service, at: new Date(d.startedAt ?? d.createdAt).getTime() });
          } catch {
            // silent-ok: older history is a nicety; the service's current deployments below still name the latest.
            const described = await ecs.send(new DescribeServicesCommand({ cluster: env.CLUSTER, services: [service] }));
            for (const d of described.services?.[0]?.deployments ?? []) deploys.push({ service: service, at: new Date(d.createdAt).getTime() });
          }
        }
        return deploys.filter((d) => Number.isFinite(d.at) && d.at >= sinceMs).sort((a, b) => b.at - a.at).slice(0, 12);
      },
    },
    ses: {
      async send({ subject, text }) {
        await ses.send(
          new SendEmailCommand({
            FromEmailAddress: env.SENDER,
            Destination: { ToAddresses: [env.RECIPIENT] },
            Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } } },
          }),
        );
      },
    },
    github: {
      /** The fine-grained token from Secrets Manager; `unset` (as created) means none yet. */
      async token() {
        const value = (await secrets.send(new GetSecretValueCommand({ SecretId: env.GITHUB_TOKEN_SECRET_ARN }))).SecretString;
        return value && value !== 'unset' ? value.trim() : null;
      },
      openIssues: (token) => github.openIssues(token),
      createIssue: (token, issue) => github.createIssue(token, issue),
      comment: (token, number, body) => github.comment(token, number, body),
    },
  };
}

let run;
exports.handler = async (event) => {
  run ??= makeRun(live(process.env), process.env);
  return run(event);
};
exports.makeRun = makeRun;
exports.githubClient = githubClient;
exports.WATERMARK_KEY = WATERMARK_KEY;
