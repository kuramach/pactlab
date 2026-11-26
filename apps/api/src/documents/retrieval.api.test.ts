import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  defaultPromptRegistry,
  neutralizeMarkup,
  ScriptedModelTransport,
  TransportClaudeGateway,
  type ModelRequest,
} from '@pactlab/ai';
import { retrievalRoom, type RetrievalQuestion } from '@pactlab/ai/evals';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { contextBudgetChars, MAX_CONTEXT_CHARS } from './documents.service';
import { InMemoryObjectStore } from './testing';
import { SignatureMalwareScanner } from './upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
/** A budget a tenth of the default, to see how recall falls as fewer pages fit. */
const TIGHT_BUDGET = 60_000;

type Body = Record<string, unknown>;
interface Coverage {
  strategy: 'FULL' | 'KEYWORD';
  partial: boolean;
  documentsSearched: number;
  pagesSearched: number;
  documentsRead: number;
  pagesRead: number;
  summary: string;
  documents: { documentId: string; documentName: string; pageNumbers: number[] }[];
  moreDocuments: number;
}
interface RetrievalRow { strategy: string; budgetChars: number; pagesRead: number; pages?: { pageId: string; documentId: string; pageNumber: number; checksum: string }[] }

/** The source blocks of a prompt: citation id → block text. */
function blocks(request: ModelRequest): Map<string, string> {
  const prompt = request.messages[0]?.content ?? '';
  return new Map(prompt.split('<untrusted_source ').slice(1).map((block) => [/citation_id="([^"]+)"/.exec(block)?.[1] ?? '', block]));
}

/**
 * Retrieval for pact-wide Q&A (T-139, ADR 0047). The scripted model answers from the planted clause when it was
 * sent and says it cannot answer otherwise, so end-to-end correctness here measures the pipeline (selection,
 * prompt, grounding, citation check); a real model's answer quality is the live eval's job.
 */
describe('pact-wide retrieval', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let tight: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let small: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  let expected: string | null = null;
  const prompts: ModelRequest[] = [];
  const room = retrievalRoom();
  const ids = new Map<string, string>();

  async function token(subject: string, org: string) {
    return new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(key);
  }

  async function call(target: NestFastifyApplication, who: string, dealId: string, method: 'GET' | 'POST', path: string, payload?: Body) {
    const response = await target.inject({ method, url: `/v1/deals/${dealId}${path}`, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() as Body };
  }

  const upload = (who: string, dealId: string, fileName: string, pages: readonly string[], extra: Body = {}) =>
    call(app, who, dealId, 'POST', '/documents', { fileName, contentType: 'text/plain', contentBase64: Buffer.from(pages.join('\f'), 'utf8').toString('base64'), ...extra });

  async function retrieval(aiRunId: unknown): Promise<RetrievalRow | null> {
    const result = (await db.owner.query(`SELECT retrieval FROM ai_runs WHERE id = $1`, [aiRunId])) as { rows: { retrieval: RetrievalRow | null }[] };
    return result.rows[0]?.retrieval ?? null;
  }

  async function answerPageId(answer: RetrievalQuestion['answer']) {
    const result = (await db.owner.query(`SELECT id FROM document_pages WHERE document_id = $1 AND page_number = $2`, [ids.get(answer.fileName), answer.pageNumber])) as { rows: { id: string }[] };
    return result.rows[0]!.id;
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    small = await createSyntheticTenant(db.owner, 'Small');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identityVerifier = new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) });
    const logger = createLogger('api-test', { level: 'silent' });
    const transport = new ScriptedModelTransport((request) => {
      prompts.push(request);
      const hit = expected === null ? undefined : [...blocks(request)].find(([, text]) => text.includes(neutralizeMarkup(expected!)));
      return JSON.stringify(
        hit
          ? { unanswerable: false, answer: 'The clause answers it.', claims: [{ statement: 'The clause answers the question.', citations: [{ citationId: hit[0], quote: expected }] }] }
          : { unanswerable: true, answer: 'The pages read do not answer this.', claims: [] },
      );
    });
    const gateway = new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() });
    const documents = { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner(), gateway };
    app = await createApp({ prisma: db.prisma, identityVerifier, logger, documents });
    tight = await createApp({ prisma: db.prisma, identityVerifier, logger, documents: { ...documents, contextBudgetChars: TIGHT_BUDGET } });
    tokens['a'] = await token(a.subject, a.auth0OrganizationId);
    tokens['b'] = await token(b.subject, b.auth0OrganizationId);
    tokens['small'] = await token(small.subject, small.auth0OrganizationId);

    for (const document of room.documents) {
      const uploaded = await upload('a', a.dealId, document.fileName, document.pages);
      expect(uploaded.status).toBe(201);
      ids.set(document.fileName, uploaded.body['id'] as string);
    }
    // Pages that must never be sent, however well they match: people data, an AI-excluded file, and another tenant.
    const bait = 'Customer may terminate this Agreement upon a Change of Control of Vendor.';
    expect((await upload('a', a.dealId, 'Retention bonuses (synthetic).txt', [`PEOPLE-NOTE change of control retention bonus for the leadership team. ${bait}`], { dataClass: 'HR', aiExcluded: true })).status).toBe(201);
    expect((await upload('a', a.dealId, 'Board notes (synthetic).txt', [`EXCLUDED-NOTE ${bait}`], { aiExcluded: true })).status).toBe(201);
    expect((await upload('b', b.dealId, 'Bravo MSA (synthetic).txt', [`BRAVO-ONLY ${bait}`])).status).toBe(201);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await tight?.close();
    await db?.stop();
  });

  const ask = async (target: NestFastifyApplication, question: string, extra: Body = {}) => {
    prompts.length = 0;
    return call(target, 'a', a.dealId, 'POST', '/questions', { question, ...extra });
  };

  it('reads the budget knob, refusing nonsense', () => {
    expect(contextBudgetChars({})).toBe(MAX_CONTEXT_CHARS);
    expect(contextBudgetChars({ AI_CONTEXT_BUDGET_CHARS: '200000' })).toBe(200_000);
    expect(() => contextBudgetChars({ AI_CONTEXT_BUDGET_CHARS: '12.5' })).toThrow(/AI_CONTEXT_BUDGET_CHARS/);
    expect(() => contextBudgetChars({ AI_CONTEXT_BUDGET_CHARS: '10' })).toThrow(/AI_CONTEXT_BUDGET_CHARS/);
  });

  it('answers over the budget with cited pages instead of refusing, and says what it read', async () => {
    const question = room.questions.find((q) => q.id === 'coc')!;
    expected = question.answer.quote;
    const asked = await ask(app, question.question);
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ status: 'ANSWERED' });
    const citation = (asked.body['claims'] as { citations: { documentName: string; pageNumber: number }[] }[])[0]!.citations[0]!;
    expect(citation).toMatchObject({ documentName: question.answer.fileName, pageNumber: question.answer.pageNumber });
    const coverage = asked.body['coverage'] as Coverage;
    expect(coverage).toMatchObject({ strategy: 'KEYWORD', partial: true, documentsSearched: room.documents.length, pagesSearched: 1_500 });
    expect(coverage.pagesRead).toBeGreaterThan(0);
    expect(coverage.pagesRead).toBeLessThan(1_500);
    expect(coverage.summary).toBe(`Searched 60 documents (1500 pages); read the ${coverage.pagesRead} most relevant pages.`);
    expect(coverage.documents.length).toBeLessThanOrEqual(10);
    // The run records the strategy and the pages sent, by id and checksum, never their text.
    const record = (await retrieval(asked.body['aiRunId']))!;
    expect(record).toMatchObject({ strategy: 'KEYWORD', budgetChars: MAX_CONTEXT_CHARS, pagesRead: coverage.pagesRead });
    expect(record.pages).toHaveLength(coverage.pagesRead);
    expect(record.pages).toContainEqual(expect.objectContaining({ pageId: await answerPageId(question.answer), pageNumber: question.answer.pageNumber }));
    expect(JSON.stringify(record)).not.toContain('Change of Control');
    // What reached the model fits the budget.
    const sent = [...blocks(prompts[0]!).values()].reduce((n, text) => n + text.length, 0);
    expect(sent).toBeLessThan(MAX_CONTEXT_CHARS * 1.2);
  });

  it('is deterministic: the same question on the same data sends the same pages', async () => {
    expected = null;
    const first = await ask(app, 'Which agreements let the customer terminate on a change of control?');
    const second = await ask(app, 'Which agreements let the customer terminate on a change of control?');
    expect((await retrieval(second.body['aiRunId']))?.pages).toEqual((await retrieval(first.body['aiRunId']))?.pages);
  });

  it('never sends people data, AI-excluded pages or another tenant’s pages, however well they match', async () => {
    expected = null;
    await ask(app, 'change of control retention bonus terminate agreement vendor customer');
    const prompt = prompts[0]!.messages[0]!.content;
    expect(prompt).not.toContain('PEOPLE-NOTE');
    expect(prompt).not.toContain('EXCLUDED-NOTE');
    expect(prompt).not.toContain('BRAVO-ONLY');
    // Bravo's own question over Bravo's room reads only Bravo's page.
    prompts.length = 0;
    const theirs = await call(app, 'b', b.dealId, 'POST', '/questions', { question: 'change of control' });
    expect(theirs.status).toBe(200);
    expect(prompts[0]!.messages[0]!.content).not.toContain('Example Vendor');
  });

  it('over a partial read with nothing matching, says so without a model call and offers to narrow', async () => {
    const asked = await ask(app, 'zzyzx quokka');
    expect(asked.status).toBe(200);
    expect(prompts).toHaveLength(0);
    expect(asked.body).toMatchObject({ status: 'UNANSWERABLE', aiRunId: null, answer: null, claims: [], generatedBy: null });
    expect(asked.body['coverage']).toMatchObject({ strategy: 'KEYWORD', partial: true, pagesRead: 0, documentsSearched: 60 });
  });

  it('narrowed to chosen documents that fit, reads them whole', async () => {
    const question = room.questions.find((q) => q.id === 'walk-away')!;
    expected = question.answer.quote;
    const asked = await ask(app, question.question, { documentIds: [ids.get(question.answer.fileName)] });
    expect(asked.body).toMatchObject({ status: 'ANSWERED', coverage: { strategy: 'FULL', partial: false, pagesRead: 25, documentsSearched: 1 } });
    expect((asked.body['coverage'] as Coverage).summary).toBe('Read all 25 pages of 1 documents.');
  });

  it('under the budget behaves exactly as before: every page, in order, and a FULL run', async () => {
    const pages = ['MASTER AGREEMENT (synthetic).', 'Fees are payable monthly.', 'Customer may terminate this Agreement upon a Change of Control of Vendor.'];
    const first = await upload('small', small.dealId, 'MSA (synthetic).txt', pages);
    const second = await upload('small', small.dealId, 'Order form (synthetic).txt', ['Order form for 50 seats (synthetic).']);
    expected = pages[2]!;
    prompts.length = 0;
    const asked = await call(app, 'small', small.dealId, 'POST', '/questions', { question: 'Can they walk away if we buy them?' });
    expect(asked.body).toMatchObject({ status: 'ANSWERED', coverage: { strategy: 'FULL', partial: false, pagesRead: 4, documentsSearched: 2 } });
    const order = (await db.owner.query(`SELECT id FROM document_pages WHERE deal_id = $1 ORDER BY document_id, page_number`, [small.dealId])) as { rows: { id: string }[] };
    expect([...blocks(prompts[0]!).keys()]).toEqual(order.rows.map((row) => row.id));
    expect(await retrieval(asked.body['aiRunId'])).toEqual({ strategy: 'FULL', budgetChars: MAX_CONTEXT_CHARS, documentsSearched: 2, pagesSearched: 4, pagesRead: 4 });
    expect([first.status, second.status]).toEqual([201, 201]);
  });

  it('eval: recall at the budget and end-to-end answers over the synthetic room', async () => {
    const rows: { id: string; kind: string; budget: number; recall: number; answered: boolean; pagesRead: number }[] = [];
    for (const [target, budget] of [[app, MAX_CONTEXT_CHARS], [tight, TIGHT_BUDGET]] as const) {
      for (const question of room.questions) {
        expected = question.answer.quote;
        const asked = await ask(target, question.question);
        expect(asked.status).toBe(200);
        const record = asked.body['aiRunId'] ? await retrieval(asked.body['aiRunId']) : null;
        const answerPage = await answerPageId(question.answer);
        const recall = record?.pages?.some((page) => page.pageId === answerPage) ? 1 : 0;
        const cited = (asked.body['claims'] as { citations: { documentName: string; pageNumber: number }[] }[]).some((claim) =>
          claim.citations.some((c) => c.documentName === question.answer.fileName && c.pageNumber === question.answer.pageNumber),
        );
        rows.push({ id: question.id, kind: question.kind, budget, recall, answered: asked.body['status'] === 'ANSWERED' && cited, pagesRead: (asked.body['coverage'] as Coverage).pagesRead });
      }
    }
    const mean = (kind: string, budget: number, field: 'recall' | 'answered') => {
      const set = rows.filter((row) => row.kind === kind && row.budget === budget);
      return set.reduce((n, row) => n + Number(row[field]), 0) / set.length;
    };
    const summary = [MAX_CONTEXT_CHARS, TIGHT_BUDGET].flatMap((budget) =>
      ['KEYWORD', 'PARAPHRASE'].map((kind) => `${kind} @${budget}: recall ${mean(kind, budget, 'recall').toFixed(2)}, answered ${mean(kind, budget, 'answered').toFixed(2)}`),
    );
    // The measured table, recorded in ADR 0047's decision note: a change to ranking or selection shows here as a diff.
    expect(summary).toEqual([
      'KEYWORD @600000: recall 1.00, answered 1.00',
      'PARAPHRASE @600000: recall 0.71, answered 0.71',
      'KEYWORD @60000: recall 1.00, answered 1.00',
      'PARAPHRASE @60000: recall 0.43, answered 0.43',
    ]);
    // A recalled page is always answered and cited: retrieval never weakens the citation gate.
    expect(rows.filter((row) => row.recall === 1).every((row) => row.answered)).toBe(true);
    // Questions in the documents' own words are found at the default budget.
    expect(mean('KEYWORD', MAX_CONTEXT_CHARS, 'recall')).toBe(1);
    expect(mean('KEYWORD', TIGHT_BUDGET, 'recall')).toBe(1);
    // Paraphrases are where keyword search misses (ADR 0047's decision note); this guards against getting worse.
    expect(mean('PARAPHRASE', MAX_CONTEXT_CHARS, 'recall')).toBeGreaterThanOrEqual(5 / 7);
  }, 300_000);
});
