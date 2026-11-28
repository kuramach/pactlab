import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureRequests, type FeatureFileInput } from './feature-requests';
import { OperatorRequiredError, prismaExecutor, type SqlExecutor } from './ops';
import { withTenant } from './tenant';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

/**
 * T-176: feature requests become proposals. Anonymous requests are not stored, a similar request attaches as a
 * suggested supporter until the triager confirms it, a declined proposal keeps its reason and resurfaces, a
 * requester sees only their own, and only an operator triages.
 */
describe('feature proposals', () => {
  let db: TestDatabase;
  let sql: SqlExecutor;
  let operator: SyntheticTenant;
  let ann: SyntheticTenant;
  let ben: SyntheticTenant;

  const app = (who: SyntheticTenant, title: string, description: string, matchId: string | null = null): FeatureFileInput => ({
    organizationId: who.organizationId, userId: who.userId, email: null, surface: 'APP', locale: 'en', page: '/findings', title, description, transcript: [{ role: 'user', text: description }], matchId,
  });
  const site = (email: string, title: string, description: string, matchId: string | null = null): FeatureFileInput => ({
    organizationId: null, userId: null, email, surface: 'SITE', locale: 'en', page: '/', title, description, transcript: [], matchId,
  });

  beforeAll(async () => {
    db = await startTestDatabase();
    sql = prismaExecutor(db.prisma);
    operator = await createSyntheticTenant(db.owner, 'Ops');
    ann = await createSyntheticTenant(db.owner, 'Ann');
    ben = await createSyntheticTenant(db.owner, 'Ben');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
  }, 60_000);
  afterAll(async () => db?.stop());

  it('stores no anonymous request, and the runtime role reads neither table directly', async () => {
    const proposal = await featureRequests.file(sql, app(ann, 'Anything at all', 'a request to hang the check on'));
    await expect(db.owner.query(`INSERT INTO feature_proposal_supporters (id, proposal_id, surface, locale, page, title, description, grouped_as) VALUES (uuidv7(), $1, 'SITE', 'en', '/', 'x', 'y', 'ORIGINAL')`, [proposal.proposalId])).rejects.toThrow(/who_check/);
    await expect(featureRequests.file(sql, site('', 'Export to Excel', 'export findings'))).rejects.toThrow();
    for (const table of ['feature_proposals', 'feature_proposal_supporters']) {
      await expect(withTenant(db.prisma, ann.context, (tx) => tx.$queryRawUnsafe(`SELECT count(*) FROM ${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it('files a request, groups a similar one as a suggested supporter, and counts it only once confirmed', async () => {
    const first = await featureRequests.file(sql, app(ann, 'Export findings to Excel', 'I want the findings list as an Excel file'));
    expect(first).toMatchObject({ outcome: 'CREATED', earlierStatus: null });
    const second = await featureRequests.file(sql, site('visitor@example.test', 'Excel export of findings', 'Let me export findings to excel', first.proposalId));
    expect(second).toMatchObject({ outcome: 'ATTACHED', proposalId: first.proposalId });

    const listed = await featureRequests.queuePage(sql, operator.userId, {}, { limit: 50 });
    const row = listed.items.find((item) => item.id === first.proposalId);
    expect(row).toMatchObject({ supporters: 1, suggested: 1, status: 'SUBMITTED' });

    const supporters = await featureRequests.supportersPage(sql, operator.userId, first.proposalId ?? '', { limit: 50 });
    const suggested = supporters.items.find((item) => item.grouping === 'SUGGESTED');
    expect(suggested).toMatchObject({ email: 'visitor@example.test', surface: 'SITE' });
    expect(await featureRequests.group(sql, operator.userId, suggested?.id ?? '', true)).toBe(first.proposalId);
    expect((await featureRequests.queuePage(sql, operator.userId, {}, { limit: 50 })).items.find((item) => item.id === first.proposalId)).toMatchObject({ supporters: 2, suggested: 0 });
    // The same person asking twice is one supporter.
    await featureRequests.file(sql, site('VISITOR@example.test', 'Excel export of findings', 'again', first.proposalId));
    expect((await featureRequests.supportersPage(sql, operator.userId, first.proposalId ?? '', { limit: 50 })).total).toBe(2);
  });

  it('splits a suggested requester the triager says asked for something else', async () => {
    const base = await featureRequests.file(sql, app(ann, 'Dark theme for the app', 'a dark colour scheme please'));
    await featureRequests.file(sql, app(ben, 'Night mode but for printing', 'something else entirely', base.proposalId));
    const suggested = (await featureRequests.supportersPage(sql, operator.userId, base.proposalId ?? '', { limit: 50 })).items.find((item) => item.grouping === 'SUGGESTED');
    const split = await featureRequests.group(sql, operator.userId, suggested?.id ?? '', false);
    expect(split).not.toBe(base.proposalId);
    expect((await featureRequests.get(sql, operator.userId, split ?? ''))?.title).toBe('Night mode but for printing');
  });

  it('keeps a declined request with its reason, and shows it when the same thing is asked again', async () => {
    const filed = await featureRequests.file(sql, app(ann, 'Built-in video calls', 'host calls inside Pactlab'));
    expect(await featureRequests.decide(sql, operator.userId, filed.proposalId ?? '', 'DECLINE', 'Not a diligence tool: use your own meeting app.')).toBe(true);
    const again = await featureRequests.file(sql, app(ben, 'Video calls in Pactlab', 'calls inside the app', filed.proposalId));
    expect(again).toMatchObject({ outcome: 'CREATED', earlierStatus: 'DECLINED', earlierReason: 'Not a diligence tool: use your own meeting app.' });
    expect(await featureRequests.get(sql, operator.userId, again.proposalId ?? '')).toMatchObject({ relatedStatus: 'DECLINED', relatedReason: 'Not a diligence tool: use your own meeting app.' });
    const found = await featureRequests.queuePage(sql, operator.userId, { query: 'meeting app' }, { limit: 50 });
    expect(found.items.map((item) => item.id)).toContain(filed.proposalId);
  });

  it("shows a requester only their own requests, in plain status, with a decline's reason", async () => {
    const annOwn = await featureRequests.minePage(sql, ann.userId, { limit: 50 });
    const benOwn = await featureRequests.minePage(sql, ben.userId, { limit: 50 });
    expect(annOwn.items.every((item) => item.title !== 'Video calls in Pactlab')).toBe(true);
    expect(benOwn.items.map((item) => item.title)).toContain('Video calls in Pactlab');
    expect(annOwn.items.find((item) => item.title === 'Built-in video calls')).toMatchObject({ status: 'DECLINED', declineReason: 'Not a diligence tool: use your own meeting app.' });
    expect(benOwn.items.every((item) => item.declineReason === null || item.status === 'DECLINED')).toBe(true);
  });

  it('refuses every operator action to anyone else, and audits the ones that ran', async () => {
    const filed = await featureRequests.file(sql, app(ben, 'Bulk edit of assumptions', 'edit many assumptions at once'));
    const id = filed.proposalId ?? '';
    for (const attempt of [
      () => featureRequests.queuePage(sql, ann.userId, {}, { limit: 10 }),
      () => featureRequests.get(sql, ann.userId, id),
      () => featureRequests.supportersPage(sql, ann.userId, id, { limit: 10 }),
      () => featureRequests.decide(sql, ann.userId, id, 'DECLINE', null),
      () => featureRequests.approve(sql, ann.userId, id, {}),
      () => featureRequests.link(sql, ann.userId, id, { taskId: 'T-300', pullRequestUrl: null, whatsNewUrl: null }),
      () => featureRequests.group(sql, ann.userId, id, true),
      () => featureRequests.siteRequesters(sql, ann.userId, id),
    ]) await expect(attempt()).rejects.toBeInstanceOf(OperatorRequiredError);
    expect((await featureRequests.get(sql, operator.userId, id))?.status).toBe('SUBMITTED');
    expect(await featureRequests.approve(sql, operator.userId, id, { title: 'Bulk edit' })).toBe(true);
    expect(await featureRequests.decide(sql, operator.userId, id, 'DECLINE', null)).toBe(false); // an approved request has a task
    expect(await featureRequests.link(sql, operator.userId, id, { taskId: 'T-300', pullRequestUrl: null, whatsNewUrl: null })).toBe(true);
    expect(await featureRequests.link(sql, operator.userId, id, { taskId: null, pullRequestUrl: null, whatsNewUrl: '/whats-new#bulk' })).toBe(true);
    expect(await featureRequests.get(sql, operator.userId, id)).toMatchObject({ status: 'SHIPPED', taskId: 'T-300', whatsNewUrl: '/whats-new#bulk' });
    const audited = await db.owner.query(`SELECT action FROM audit_events WHERE action LIKE 'feature_request.%'`);
    expect((audited.rows as { action: string }[]).map((row) => row.action)).toEqual(expect.arrayContaining(['feature_request.grouped', 'feature_request.split', 'feature_request.decline', 'feature_request.approved', 'feature_request.linked']));
  });

  it('asks a question, and the requester\'s reply reopens it', async () => {
    const filed = await featureRequests.file(sql, app(ann, 'Better charts', 'the charts could be better'));
    const id = filed.proposalId ?? '';
    await expect(featureRequests.decide(sql, operator.userId, id, 'REQUEST_INFO', '')).rejects.toThrow();
    expect(await featureRequests.decide(sql, operator.userId, id, 'REQUEST_INFO', 'Which chart, and what is missing?')).toBe(true);
    expect((await featureRequests.minePage(sql, ann.userId, { limit: 50 })).items.find((item) => item.proposalId === id)).toMatchObject({ status: 'INFO_REQUESTED', question: 'Which chart, and what is missing?' });
    expect(await featureRequests.reply(sql, ben.userId, id, 'not mine')).toBe(false);
    expect(await featureRequests.reply(sql, ann.userId, id, 'The valuation bridge: it needs labels.')).toBe(true);
    expect(await featureRequests.get(sql, operator.userId, id)).toMatchObject({ status: 'IN_TRIAGE', infoReply: 'The valuation bridge: it needs labels.' });
  });

  it('rate limits one person to five requests a day', async () => {
    const who = await createSyntheticTenant(db.owner, 'Chatty');
    const outcomes: string[] = [];
    for (let n = 0; n < 6; n += 1) outcomes.push((await featureRequests.file(sql, app(who, `Distinct idea number ${n}`, `wholly unrelated thing ${n}`))).outcome);
    expect(outcomes).toEqual(['CREATED', 'CREATED', 'CREATED', 'CREATED', 'CREATED', 'RATE_LIMITED']);
  });
});
