'use strict';
/**
 * Log triage (T-150 live, T-157 dev, qa and stage; ADR 0048): once a day in one
 * account, sweep each of its environments' logs since that environment's last
 * successful run, cluster the errors, ask Bedrock for a verdict on each
 * reportable cluster (or, with no model configured, leave them unclassified),
 * open or update one GitHub issue per finding worth a look, and email one
 * digest for the account. Nothing reportable anywhere: no email.
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
  const environments = triage.environmentsFrom(env);
  const single = environments.length === 1 && environments[0].profile.scope === 'live';
  const maxClusters = Number(env.MAX_CLUSTERS || triage.DEFAULT_MAX_CLUSTERS);
  // No model configured: cluster-only (T-157), no Bedrock call at all. Setting MODEL_ID flips it to full verdicts.
  const classify = Boolean(env.MODEL_ID);
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

  /** Sweep one environment: queries, clusters, reportability and verdicts. Writes nothing. */
  async function sweep(environment, nowMs, dryRun) {
    const { profile } = environment;
    const watermark = await deps.state.getWatermark(profile.statePrefix);
    const window = triage.sweepWindow(watermark, nowMs);

    // Inventory: only the configured groups that exist; a missing one is said, not skipped silently.
    const existing = new Set(
      // handled: the warning is logged and the configured groups are queried anyway.
      await deps.logs.listLogGroups(environment.logGroupPrefix).catch((error) => {
        log({ level: 'warn', message: 'log group inventory unavailable; querying the configured groups', environment: profile.name, errorName: error?.name });
        return environment.logGroups;
      }),
    );
    const groups = environment.logGroups.filter((name) => existing.has(name));
    const missing = environment.logGroups.filter((name) => !existing.has(name));
    if (missing.length) log({ level: 'warn', message: 'log groups not found', environment: profile.name, missing });
    if (!groups.length) return { environment, missingAll: true };

    const resultsByKind = {};
    const truncated = [];
    const results = await Promise.all(triage.QUERIES.map((spec) => runQuery(spec, groups, window)));
    triage.QUERIES.forEach((spec, index) => {
      resultsByKind[spec.kind] = results[index];
      if (results[index].length >= triage.QUERY_LIMIT) truncated.push(spec.label);
    });

    const clusters = triage.cluster(resultsByKind, options);
    const states = await deps.state.getStates(clusters.map((c) => c.signature), profile.statePrefix);
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
    log({ message: 'sweep', environment: profile.name, window, dryRun, groups, clusters: clusters.length, reportable: reportable.length, deferred, classify });

    const deploys = classify && selected.length
      ? // handled: the prompt then says no deploys are known; the warning is logged.
        await deps.ecs.recentDeploys(nowMs - DEPLOY_LOOKBACK_MS, environment).catch((error) => {
          log({ level: 'warn', message: 'deploy history unavailable', environment: profile.name, errorName: error?.name });
          return [];
        })
      : [];

    const triaged = [];
    for (const item of selected) {
      if (!classify) {
        triaged.push({ ...item, ...triage.unclassified(item) });
        continue;
      }
      let response = null;
      try {
        response = await deps.bedrock.converse(triage.triageRequest(item, deploys, env.MODEL_ID));
      } catch (error) {
        log({ level: 'warn', message: 'triage call failed', environment: profile.name, signature: item.signature, errorName: error?.name });
      }
      triaged.push({ ...item, ...triage.parseVerdict(response, item, options) });
    }
    const context = { window, logGroups: groups, dryRun, truncated, deferred, maxClusters };
    return { environment, clusters, assessed, reportable, triaged, context };
  }

  /** Issues for what a person should look at in one environment; never for noise. */
  async function fileIssues(result, token, dryRun) {
    const { profile } = result.environment;
    // Read even in a dry run, so its draft can say which issues it would comment on instead of opening.
    const open = token
      ? // handled: the clusters stay pending_issue and the digest says GitHub was unavailable.
        await deps.github.openIssues(token, profile.labels).catch((error) => {
          log({ level: 'warn', message: 'could not list open issues', environment: profile.name, errorName: error?.name });
          return null;
        })
      : null;
    const bySignature = new Map((open ?? []).map((issue) => [triage.signatureFromBody(issue.body, profile), issue]).filter(([sig]) => sig));
    for (const item of result.triaged) {
      if (item.verdict === 'likely_noise') continue;
      const existingIssue = bySignature.get(item.signature);
      if (dryRun) {
        item.issueUrl = existingIssue ? `${existingIssue.html_url} (would comment)` : '(would open a new issue)';
        log({
          message: 'dry run: issue',
          environment: profile.name,
          action: existingIssue ? 'comment' : 'open',
          issue: existingIssue?.number ?? null,
          title: triage.issueTitle(item, profile),
          labels: profile.labels,
          body: existingIssue ? triage.issueComment(item, result.context) : triage.issueBody(item, result.context, profile),
        });
        continue;
      }
      if (!token || open === null) {
        item.issueFailed = true;
        item.issueUrl = token ? 'not opened (GitHub unavailable; retried next run)' : 'not opened (GitHub token not set; retried once it is)';
        continue;
      }
      try {
        if (existingIssue) {
          await deps.github.comment(token, existingIssue.number, triage.issueComment(item, result.context));
          item.issueNumber = existingIssue.number;
          item.issueUrl = existingIssue.html_url;
        } else {
          const created = await deps.github.createIssue(token, { title: triage.issueTitle(item, profile), body: triage.issueBody(item, result.context, profile), labels: profile.labels });
          item.issueNumber = created.number;
          item.issueUrl = created.html_url;
        }
      } catch (error) {
        log({ level: 'warn', message: 'issue write failed', environment: profile.name, signature: item.signature, errorName: error?.name, status: error?.status });
        item.issueFailed = true;
        item.issueUrl = 'not opened (GitHub refused; retried next run)';
      }
    }
  }

  return async function run(event = {}) {
    const dryRun = env.DRY_RUN === 'true' || event?.dryRun === true;
    const nowMs = deps.now();
    // A manual run may name some of the account's environments (`{ "environments": ["qa"] }`), e.g. one env's dry run.
    const only = Array.isArray(event?.environments) ? new Set(event.environments) : null;
    const chosen = only ? environments.filter((e) => only.has(e.profile.name)) : environments;
    if (!chosen.length) throw new Error('The event names none of this deployment\'s environments');

    const swept = [];
    for (const environment of chosen) swept.push(await sweep(environment, nowMs, dryRun));
    if (swept.every((s) => s.missingAll)) throw new Error('None of the configured log groups exist');
    const results = swept.filter((s) => !s.missingAll);

    const token = await deps.github.token();
    for (const result of results) await fileIssues(result, token, dryRun);

    const digest = single
      ? triage.renderDigest(results[0].triaged, results[0].context)
      : triage.renderAccountDigest(
          results.map((r) => ({ profile: r.environment.profile, items: r.triaged, context: r.context })),
          { dryRun, classify, end: Math.floor(nowMs / 1000), account: env.ACCOUNT_LABEL || 'account' },
        );
    const totals = {
      clusters: results.reduce((n, r) => n + r.clusters.length, 0),
      reportable: results.reduce((n, r) => n + r.reportable.length, 0),
      triaged: results.reduce((n, r) => n + r.triaged.length, 0),
      environments: Object.fromEntries(results.map((r) => [r.environment.profile.name, { clusters: r.clusters.length, reportable: r.reportable.length, triaged: r.triaged.length }])),
    };
    if (dryRun) {
      log({ message: 'dry run: digest', subject: digest?.subject ?? null, text: digest?.text ?? 'Nothing reportable: no email would be sent.' });
      return { dryRun: true, ...totals };
    }
    if (digest) await deps.ses.send(digest);

    // Only after the digest went out: each environment's state, then its watermark (a failed run sweeps its window again).
    for (const result of results) {
      const prefix = result.environment.profile.statePrefix;
      const byTriaged = new Map(result.triaged.map((item) => [item.signature, item]));
      await deps.state.putStates(
        result.assessed.map((c) => {
          const item = byTriaged.get(c.signature);
          const outcome = item ? { verdict: item.issueFailed ? 'pending_issue' : item.verdict, issueNumber: item.issueNumber, headline: item.headline } : null;
          return triage.nextState(c, c.state, outcome, nowMs, prefix);
        }),
      );
      await deps.state.putWatermark(result.context.window.end * 1000, prefix);
    }
    return { dryRun: false, ...totals, emailed: Boolean(digest) };
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
    /** Open issues carrying every one of `labels` (not pull requests), at most 1,000. */
    async openIssues(token, labels = ['live-triage']) {
      const issues = [];
      const filter = labels.map(encodeURIComponent).join(',');
      for (let page = 1; page <= 10; page += 1) {
        const batch = await call(token, 'GET', `/issues?state=open&labels=${filter}&per_page=100&page=${page}`);
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
  const github = githubClient(env.GITHUB_REPO);

  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logs: {
      async listLogGroups(prefix) {
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
      // An environment's keys carry its prefix (`qa#SIG#…`, `qa#WATERMARK`); live's have none, as T-150 stored them.
      async getWatermark(prefix = '') {
        const item = (await dynamo.send(new GetItemCommand({ TableName: table, Key: marshall({ pk: `${prefix}${WATERMARK_KEY}` }) }))).Item;
        return item ? Number(unmarshall(item).at) : null;
      },
      async putWatermark(at, prefix = '') {
        await dynamo.send(new PutItemCommand({ TableName: table, Item: marshall({ pk: `${prefix}${WATERMARK_KEY}`, at }) }));
      },
      async getStates(signatures, prefix = '') {
        const out = {};
        for (let i = 0; i < signatures.length; i += 100) {
          let keys = signatures.slice(i, i + 100).map((sig) => marshall({ pk: `${prefix}SIG#${sig}` }));
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
      /**
       * Deploy start times per service of one environment: the deployment history, else the deployments the
       * service still lists. An environment whose services live in another stack (qa, swept from dev's) names none.
       */
      async recentDeploys(sinceMs, environment) {
        const deploys = [];
        for (const service of environment.services) {
          try {
            const page = await ecs.send(new ListServiceDeploymentsCommand({ cluster: environment.cluster, service, createdAt: { after: new Date(sinceMs) } }));
            for (const d of page.serviceDeployments ?? []) deploys.push({ service, at: new Date(d.startedAt ?? d.createdAt).getTime() });
          } catch {
            // silent-ok: older history is a nicety; the service's current deployments below still name the latest.
            const described = await ecs.send(new DescribeServicesCommand({ cluster: environment.cluster, services: [service] }));
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
      openIssues: (token, labels) => github.openIssues(token, labels),
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
