import { randomInt, randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { classifyDocument, GatewayPolicyError, readPageImage, type AiRunRecord, type CitableSource } from '@pactlab/ai';
import type { PrepInvitePreview, PreparerBindingView, PreparerSession, RinseClassifyBody, RinseClassifyResult, RinseVisionBody, RinseVisionResult } from '@pactlab/contracts';
import { authSessions, emailLogin, rinsePreparers, type PrismaClient } from '@pactlab/db';
import { categoriesForPack, categoryDefinition, COMPANY_TYPES, decideIntake, packFor, type CompanyType, type IntakeCategory } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { keyedHash, normalizeEmail } from '../email-login/client-address';
import { emails } from '../email-login/emails';
import { LOGGER, PRISMA } from '../tokens';
import { prepTokenHash } from './prep-invites.service';
import { RINSE_DEPENDENCIES, type RinseDependencies } from './rinse.tokens';

const CODE_TTL_MINUTES = 10;
const TRUST_HOURS = { '1d': 24, '1w': 168, '30d': 720 } as const;
const DEFAULT_LIMITS = { perTenMinutes: 120, perDay: 2_000 };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Pactlab Rinse preparers (T-178b, ADR 0059), the desktop's side of the API. One flow signs a preparer
 * in from an invite, whether or not they already have a Pactlab account: a new address gets a free
 * PREPARER workspace and the binding in one step; an existing account gets its usual sign-in code and
 * the invite is accepted on verify. Replies never reveal which happened.
 *
 * AI rinse jobs run under the signed-in preparer, through the gateway (job types classification and
 * vision, the ADR 0034 gates, the people-data check before any call), counted against the bound pact
 * (Kumar's decision 4) and rate-limited per account.
 */
@Injectable()
export class PreparerService {
  private readonly recent = new Map<string, number[]>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(RINSE_DEPENDENCIES) private readonly deps: RinseDependencies,
  ) {}

  private codeHash(email: string, code: string): string {
    return keyedHash(this.deps.hashSecret, `code:${normalizeEmail(email)}:${code}`);
  }

  async preview(token: string): Promise<PrepInvitePreview> {
    const peek = await rinsePreparers.peek(this.prisma, prepTokenHash(token));
    if (!peek) throw new NotFoundException();
    return { pactName: peek.pactName, invitedBy: peek.organizationName, email: peek.email, expiresAt: peek.expiresAt.toISOString(), state: peek.state };
  }

  async start(input: { token: string; email: string; displayName: string }, ip: string): Promise<void> {
    const email = normalizeEmail(input.email);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ipHash = keyedHash(this.deps.hashSecret, `ip:${ip}`);
    const begun = await rinsePreparers.begin(this.prisma, { tokenHash: prepTokenHash(input.token), email, displayName: input.displayName, codeHash: this.codeHash(email, code), ipHash });
    let message = null;
    if (begun?.kind === 'code') message = emails.signupCode(email, code, CODE_TTL_MINUTES);
    else if (begun?.kind === 'existing-user') {
      // An account already: its usual sign-in code; the invite is accepted when it verifies.
      const challenge = await emailLogin.begin(this.prisma, { email, codeHash: this.codeHash(email, code), ipHash });
      if (challenge) message = emails.signInCode(email, code, CODE_TTL_MINUTES);
    }
    if (!message || !this.deps.emailSender) return;
    // Not awaited: response time must not reveal whether a code was sent.
    void this.deps.emailSender
      .send(message)
      // silent-ok: a sign-in code's reply must not differ by account (no enumeration); the app says what to do when no email arrives
      .catch((error: unknown) => this.logger.error({ sender: this.deps.emailSender?.name, errorClass: error instanceof Error ? error.name : 'unknown' }, 'rinse sign-in email delivery failed'));
  }

  /** A session for the desktop, cached for offline use, and the preparer's bindings; a uniform 401 otherwise. */
  async verify(input: { token: string; email: string; code: string; trust: '8h' | '1d' | '1w' | '30d'; device?: string | undefined }): Promise<PreparerSession> {
    const email = normalizeEmail(input.email);
    const codeHash = this.codeHash(email, input.code);
    let session: { sessionId: string; subject: string; organizationId: string | null; expiresAt: Date };
    const created = await rinsePreparers.verify(this.prisma, { email, codeHash });
    if (created) {
      session = { ...created.session, organizationId: created.organizationId };
    } else {
      const existing = await emailLogin.verify(this.prisma, { email, codeHash });
      if (!existing) throw new UnauthorizedException();
      session = existing;
      // The invite may already be accepted (a second device): signing in still succeeds.
      await rinsePreparers.accept(this.prisma, existing.sessionId, prepTokenHash(input.token));
    }
    let expiresAt = session.expiresAt;
    if (input.trust !== '8h') {
      expiresAt = (await authSessions.trust(this.prisma, { sessionId: session.sessionId, hours: TRUST_HOURS[input.trust], deviceLabel: input.device ?? 'Pactlab Rinse' })) ?? expiresAt;
    }
    const token = await this.deps.tokens.issue({ subject: session.subject, sessionId: session.sessionId, organizationId: session.organizationId, expiresAt });
    return { token, expiresAt: expiresAt.toISOString(), bindings: await this.bindings(session.sessionId) };
  }

  /** A signed-in user accepts an invite addressed to them (the web or a second desktop). */
  async accept(sessionId: string | undefined, token: string): Promise<PreparerBindingView[]> {
    if (!sessionId) throw new UnauthorizedException();
    const bound = await rinsePreparers.accept(this.prisma, sessionId, prepTokenHash(token));
    if (!bound) throw new UnprocessableEntityException({ code: 'PREP_INVITE_UNAVAILABLE', message: 'This invite is not for this account, or it was used, revoked or has expired. Ask for a new one.' });
    return this.bindings(sessionId);
  }

  async bindings(sessionId: string | undefined): Promise<PreparerBindingView[]> {
    if (!sessionId) throw new UnauthorizedException();
    return (await rinsePreparers.bindings(this.prisma, sessionId)).map((binding) => ({
      bindingId: binding.bindingId,
      organizationId: binding.organizationId,
      dealId: binding.dealId,
      pactName: binding.pactName,
      invitedBy: binding.organizationName,
      boundAt: binding.boundAt.toISOString(),
    }));
  }

  /** The binding the job runs under, after the per-account limits. */
  private async bound(sessionId: string | undefined, bindingId: string, userKey: string) {
    if (!sessionId) throw new UnauthorizedException();
    const binding = (await rinsePreparers.bindings(this.prisma, sessionId)).find((candidate) => candidate.bindingId === bindingId);
    if (!binding) throw new NotFoundException();
    const limits = this.deps.limits ?? DEFAULT_LIMITS;
    const now = Date.now();
    const window = (this.recent.get(userKey) ?? []).filter((at) => now - at < 600_000);
    if (window.length >= limits.perTenMinutes || (await rinsePreparers.runsToday(this.prisma, sessionId)) >= limits.perDay) {
      throw new HttpException({ code: 'RINSE_AI_RATE_LIMITED', message: 'Too many AI steps for now; they stay queued in the app and run later.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    window.push(now);
    this.recent.set(userKey, window);
    return binding;
  }

  private async record(sessionId: string, bindingId: string, run: AiRunRecord): Promise<void> {
    if (!(await rinsePreparers.recordRun(this.prisma, sessionId, bindingId, run))) throw new NotFoundException();
  }

  async classify(sessionId: string | undefined, subject: string, body: RinseClassifyBody): Promise<RinseClassifyResult> {
    const binding = await this.bound(sessionId, body.bindingId, subject);
    if (!(COMPANY_TYPES as readonly string[]).includes(body.pack)) throw new UnprocessableEntityException({ code: 'RINSE_PACK_UNKNOWN', message: 'The set names a company type Pactlab does not know.' });
    const pack = packFor(body.pack as CompanyType);
    const documentId = randomUUID();
    const pages: CitableSource[] = body.pageTexts.map((text, index) => ({ citationId: randomUUID(), documentId, documentName: body.fileName, pageNumber: index + 1, text, classification: 'BUSINESS' }));
    let outcome;
    try {
      outcome = await classifyDocument(this.deps.gateway, {
        organizationId: binding.organizationId,
        dealId: binding.dealId,
        fileName: body.fileName,
        folder: body.folder,
        categories: categoriesForPack(pack).map((category) => ({ id: category.id, description: category.description })),
        pages,
      });
    } catch (error) {
      throw unavailable(error);
    }
    await this.record(sessionId ?? '', binding.bindingId, outcome.run);
    if (!outcome.classification) throw new ServiceUnavailableException({ code: 'AI_UNAVAILABLE', message: 'The file could not be classified now; it stays queued.' });
    const decision = decideIntake(pack, outcome.classification);
    const category = decision.category ?? outcome.classification.category;
    const known = categoriesForPack(pack).some((candidate) => candidate.id === category);
    return {
      category,
      confidence: outcome.classification.confidence,
      promptVersion: `${outcome.run.promptId}@${outcome.run.promptVersion}`,
      aiExcluded: known && categoryDefinition(category as IntakeCategory).people,
    };
  }

  async vision(sessionId: string | undefined, subject: string, body: RinseVisionBody): Promise<RinseVisionResult> {
    const binding = await this.bound(sessionId, body.bindingId, subject);
    const bytes = Buffer.from(body.image.base64, 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new UnprocessableEntityException({ code: 'RINSE_IMAGE_SIZE', message: 'A page image is at most 5 MB.' });
    let result;
    try {
      result = await readPageImage(this.deps.gateway, {
        organizationId: binding.organizationId,
        dealId: binding.dealId,
        label: `Page ${body.page} of ${body.fileName}`,
        images: [{ format: body.image.format, bytes: new Uint8Array(bytes) }],
        classification: 'BUSINESS',
      });
    } catch (error) {
      throw unavailable(error);
    }
    await this.record(sessionId ?? '', binding.bindingId, result.run);
    if (result.providerError) throw new ServiceUnavailableException({ code: 'AI_UNAVAILABLE', message: 'The page could not be read now; it stays queued.' });
    return { text: result.text, promptVersion: `${result.run.promptId}@${result.run.promptVersion}` };
  }
}

function unavailable(error: unknown): HttpException {
  if (error instanceof GatewayPolicyError) {
    return new UnprocessableEntityException({ code: error.code, message: error.code === 'PROHIBITED_DATA' ? 'People data is never sent to AI.' : 'AI is not available for this pact.' });
  }
  return new ServiceUnavailableException({ code: 'AI_UNAVAILABLE', message: 'AI could not be reached; the step stays queued.' });
}
