import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createCanvas } from '@napi-rs/canvas';
import { strToU8, zipSync } from 'fflate';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from './testing';
import { SignatureMalwareScanner } from './upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** A synthetic picture: a white page with a line of text, as a scanner would produce. */
async function picture(label: string): Promise<Uint8Array> {
  const canvas = createCanvas(600, 300);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 600, 300);
  context.fillStyle = '#000000';
  context.font = '24px sans-serif';
  context.fillText(label, 20, 150);
  return new Uint8Array(await canvas.encode('png'));
}

/** A scanned PDF: pages that are only images, no text layer. */
async function scannedPdf(pages: number, tag: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let n = 1; n <= pages; n += 1) {
    const png = await pdf.embedPng(await picture(`${tag} page ${n} (synthetic)`));
    pdf.addPage([600, 300]).drawImage(png, { x: 0, y: 0, width: 600, height: 300 });
  }
  return pdf.save();
}

/** A two-slide deck: slide 1 text only, slide 2 text and a chart picture. */
async function deck(): Promise<Uint8Array> {
  const slide = (text: string) => strToU8(`<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/slides/slide1.xml': slide('Board update Q3 (synthetic)'),
    'ppt/slides/slide2.xml': slide('Revenue bridge'),
    'ppt/slides/_rels/slide2.xml.rels': strToU8('<Relationships><Relationship Id="rId2" Target="../media/image1.png"/></Relationships>'),
    'ppt/media/image1.png': await picture('Revenue chart (synthetic)'),
  });
}

/** T-121: pages read from their images: scans, image uploads, PowerPoint slides. */
describe('reading documents from their images', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let tenant: SyntheticTenant;
  let key: CryptoKey;
  let token: string;
  let sellerToken: string;
  let failPages: Set<string>;
  const transport = new ScriptedModelTransport((request) => {
    const page = /^Page: (.+)$/m.exec(request.messages[0]?.content ?? '')?.[1] ?? '';
    if ([...failPages].some((label) => page.includes(label))) return 'not json';
    return JSON.stringify({ kind: 'SCANNED_TEXT', readable: true, text: `Read from the image of ${page}: total revenue $1,250,000.`, tables: [], charts: [], summary: 'A synthetic page.' });
  });
  const call = async (method: 'GET' | 'POST', path: string, payload?: Body, as = token) => {
    const response = await app.inject({ method, url: `/v1/deals/${tenant.dealId}${path}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() as Body };
  };
  const upload = (fileName: string, contentType: string, bytes: Uint8Array, extra: Body = {}) =>
    call('POST', '/documents', { fileName, contentType, contentBase64: Buffer.from(bytes).toString('base64'), ...extra });
  const settled = async (id: string) => {
    for (let i = 0; i < 100; i += 1) {
      const doc = (await call('GET', `/documents/${id}`)).body as { vision: { status: string } };
      if (!['PENDING', 'READING'].includes(doc.vision.status)) return doc as unknown as { vision: { status: string; pagesDone: number; failures: { page: number; reason: string }[] } };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('vision pass did not finish');
  };
  const pages = async (id: string) =>
    ((await db.owner.query(`SELECT page_number AS "n", text, text_source AS "source", vision_mode AS "mode" FROM document_pages WHERE document_id = $1 ORDER BY page_number`, [id])) as { rows: { n: number; text: string; source: string; mode: string | null }[] }).rows;

  beforeAll(async () => {
    db = await startTestDatabase();
    tenant = await createSyntheticTenant(db.owner, 'Vision');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: process.env['VISION_DEBUG'] ? 'debug' : 'silent' }),
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner(), gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() }) },
    });
    const seller = await addSyntheticDealMember(db.owner, tenant, 'TARGET_CONTRIBUTOR');
    sellerToken = await new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(seller.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(key);
    token = await new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(key);
  });
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });
  beforeEach(() => {
    failPages = new Set();
  });

  it('a scanned PDF is accepted (not refused as needing OCR) and every page is read from its image', async () => {
    const created = await upload('Scanned lease.pdf', 'application/pdf', await scannedPdf(2, 'Lease'));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body['vision']).toMatchObject({ status: 'PENDING', pagesTotal: 2 });
    expect(await settled(created.body['id'] as string)).toMatchObject({ vision: { status: 'DONE', pagesDone: 2, failures: [] } });
    const read = await pages(created.body['id'] as string);
    expect(read.map((p) => [p.source, p.mode])).toEqual([['VISION', null], ['VISION', null]]);
    expect(read[0]?.text).toContain('Read from the image of Page 1 of Scanned lease.pdf');
    // Every other job works on it: a question gets an answer cited to the read page.
    const runs = (await db.owner.query(`SELECT count(*)::int AS n FROM ai_runs WHERE job_type = 'vision' AND deal_id = $1`, [tenant.dealId])) as { rows: { n: number }[] };
    expect(runs.rows[0]?.n).toBe(2);
  });

  it('an image upload is one page, read from the image', async () => {
    const created = await upload('Rent roll photo.png', 'image/png', await picture('Unit 4B rent $1,800 (synthetic)'));
    expect(created.status).toBe(201);
    await settled(created.body['id'] as string);
    expect((await pages(created.body['id'] as string))[0]).toMatchObject({ source: 'VISION', text: expect.stringContaining('Page 1 of Rent roll photo.png') });
  });

  it("a PowerPoint deck is one page per slide; a slide's picture is read and added to its text", async () => {
    const created = await upload('Board deck.pptx', PPTX, await deck());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await settled(created.body['id'] as string);
    const slides = await pages(created.body['id'] as string);
    expect(slides[0]).toMatchObject({ source: 'TEXT', text: 'Slide 1\nBoard update Q3 (synthetic)' });
    expect(slides[1]).toMatchObject({ source: 'TEXT_AND_VISION', text: expect.stringContaining('From the page image:\nRead from the image of Slide 2 of Board deck.pptx') });
  });

  it('a page that cannot be read is listed with why; the rest are read, and Read again retries it', async () => {
    failPages.add('Page 2 of Mixed scan.pdf');
    const created = await upload('Mixed scan.pdf', 'application/pdf', await scannedPdf(2, 'Mixed'));
    const doc = await settled(created.body['id'] as string);
    expect(doc.vision).toMatchObject({ status: 'PARTIAL', failures: [{ page: 2, reason: 'The model could not read this page.' }] });
    failPages.clear();
    expect((await call('POST', `/documents/${created.body['id'] as string}/vision`)).status).toBe(202);
    expect((await settled(created.body['id'] as string)).vision.status).toBe('DONE');
  });

  it("a seller's scan is read too (page updates are otherwise buyer-side only)", async () => {
    const created = await call('POST', '/documents', { fileName: 'Seller financials scan.pdf', contentType: 'application/pdf', contentBase64: Buffer.from(await scannedPdf(1, 'Seller')).toString('base64') }, sellerToken);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const done = await settled(created.body['id'] as string);
    expect(done, JSON.stringify(done.vision)).toMatchObject({ vision: { status: 'DONE', pagesDone: 1 } });
    expect((await pages(created.body['id'] as string))[0]).toMatchObject({ source: 'VISION' });
  });

  it('a document classed as people data is never sent to a model', async () => {
    const before = transport.requests.length;
    const created = await upload('Payroll scan.pdf', 'application/pdf', await scannedPdf(1, 'Payroll'), { dataClass: 'COMPENSATION' });
    expect(created.body['vision']).toMatchObject({ status: 'SKIPPED' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(transport.requests.length).toBe(before);
  });
});
