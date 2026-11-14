import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { BrandKitView, PublicBrandView } from '@pactlab/contracts';
import { appendAuditEvent, publicBrand, withTenant, type PrismaClient } from '@pactlab/db';
import { newId, PACTLAB_BRAND, readableOnWhite, type BrandFont, type TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import type { WebFetcher } from '../common/safe-fetch';
import type { DocumentObjectStore } from '../documents/documents.repository';
import { LOGGER, PRISMA } from '../tokens';
import { extractBrand, LOGO_MAX } from './extract';
import { sniffLogo } from './image';

export const BRAND_STORE = Symbol('BRAND_STORE');
export const BRAND_FETCHER = Symbol('BRAND_FETCHER');

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const isAdmin = (tenant: TenantContext) => tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN';
type KitRow = NonNullable<Awaited<ReturnType<PrismaClient['organizationBrandKit']['findUnique']>>>;

/** The draft as stored: the logo already copied into Pactlab's store, never hotlinked. */
interface StoredDraft {
  websiteUrl: string;
  logo: { objectKey: string; type: string; width: number | null; height: number | null; from: string } | null;
  accentColor: string | null;
  primaryColor: string | null;
  font: BrandFont;
  notes: string[];
  extractedAt: string;
}

/**
 * Organization brand kits (T-123, ADR 0031). Extraction from the company website drafts a kit;
 * an admin reviews it, edits anything, or uploads a logo. A manual edit is never overwritten by
 * extraction. Accents are checked for contrast; a failing one is adjusted and the admin told.
 */
@Injectable()
export class BrandService {
  private readonly running = new Set<Promise<void>>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(BRAND_STORE) private readonly store: DocumentObjectStore,
    @Inject(BRAND_FETCHER) private readonly fetcher: WebFetcher,
  ) {}

  private view(tenant: TenantContext, organization: { name: string; slug: string; websiteUrl: string | null }, kit: KitRow | null): BrandKitView {
    const accent = kit?.accentColor ?? null;
    const readable = accent ? readableOnWhite(accent) : null;
    const draft = (kit?.draft ?? null) as StoredDraft | null;
    return {
      organizationName: organization.name,
      slug: organization.slug,
      websiteUrl: organization.websiteUrl,
      source: (kit?.source ?? 'DEFAULT') as BrandKitView['source'],
      hasLogo: Boolean(kit?.logoObjectKey),
      logoContentType: kit?.logoContentType ?? null,
      primaryColor: kit?.primaryColor ?? null,
      accentColor: accent,
      accentReadable: readable?.color ?? null,
      accentAdjusted: readable?.adjusted ?? false,
      font: (kit?.font ?? PACTLAB_BRAND.font) as BrandFont,
      draft: draft ? { websiteUrl: draft.websiteUrl, hasLogo: Boolean(draft.logo), logoFrom: draft.logo?.from ?? null, accentColor: draft.accentColor, primaryColor: draft.primaryColor, font: draft.font, notes: draft.notes, extractedAt: draft.extractedAt } : null,
      extracting: this.running.size > 0,
      canEdit: isAdmin(tenant),
    };
  }

  async get(tenant: TenantContext): Promise<BrandKitView> {
    if (tenant.organizationRole === 'GUEST') throw new NotFoundException();
    return withTenant(this.prisma, tenant, async (tx) => {
      const [organization, kit] = await Promise.all([
        tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true, slug: true, websiteUrl: true } }),
        tx.organizationBrandKit.findUnique({ where: { organizationId: tenant.organizationId } }),
      ]);
      if (!organization) throw new NotFoundException();
      return this.view(tenant, organization, kit);
    });
  }

  private requireAdmin(tenant: TenantContext) {
    if (!isAdmin(tenant)) throw new ForbiddenException();
  }

  private audit(tenant: TenantContext, action: string, requestId: string) {
    return withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, { organizationId: tenant.organizationId, actorUserId: tenant.userId, action, targetType: 'organization', targetId: tenant.organizationId, outcome: 'SUCCEEDED', requestId }),
    );
  }

  /** Save the website and draft a kit from it in the background. */
  async setWebsite(tenant: TenantContext, websiteUrl: string | null, requestId: string): Promise<BrandKitView> {
    this.requireAdmin(tenant);
    await withTenant(this.prisma, tenant, (tx) => tx.organization.update({ where: { id: tenant.organizationId }, data: { websiteUrl } }));
    await this.audit(tenant, 'brand.website_set', requestId);
    if (websiteUrl) this.extractInBackground(tenant, websiteUrl);
    return this.get(tenant);
  }

  /** Re-run extraction on the saved website (an explicit admin action); the result is a draft to review. */
  async extract(tenant: TenantContext, requestId: string): Promise<BrandKitView> {
    this.requireAdmin(tenant);
    const organization = await withTenant(this.prisma, tenant, (tx) => tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { websiteUrl: true } }));
    if (!organization?.websiteUrl) throw new UnprocessableEntityException({ code: 'BRAND_NO_WEBSITE' });
    await this.audit(tenant, 'brand.extraction_requested', requestId);
    this.extractInBackground(tenant, organization.websiteUrl);
    return this.get(tenant);
  }

  private extractInBackground(tenant: TenantContext, websiteUrl: string) {
    const job = this.runExtraction(tenant, websiteUrl).finally(() => this.running.delete(job));
    this.running.add(job);
  }

  /** Tests: wait for background extractions. */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private async runExtraction(tenant: TenantContext, websiteUrl: string): Promise<void> {
    try {
      const draft = await extractBrand(this.fetcher, websiteUrl);
      let logo: StoredDraft['logo'] = null;
      if (draft.logo) {
        const objectKey = `${tenant.organizationId}/brand/draft-${newId()}.${draft.logo.type === 'image/svg+xml' ? 'svg' : draft.logo.type === 'image/png' ? 'png' : 'jpg'}`;
        await this.store.put(objectKey, new Uint8Array(draft.logo.bytes), { contentType: draft.logo.type, sha256: sha256(draft.logo.bytes) });
        logo = { objectKey, type: draft.logo.type, width: draft.logo.width, height: draft.logo.height, from: draft.logo.from };
      }
      const stored: StoredDraft = { websiteUrl, logo, accentColor: draft.accentColor, primaryColor: draft.primaryColor, font: draft.font, notes: [...draft.notes], extractedAt: new Date().toISOString() };
      await withTenant(this.prisma, tenant, (tx) =>
        tx.organizationBrandKit.upsert({
          where: { organizationId: tenant.organizationId },
          create: { organizationId: tenant.organizationId, draft: stored as never, extraction: { notes: stored.notes } as never, extractedAt: new Date() },
          update: { draft: stored as never, extraction: { notes: stored.notes } as never, extractedAt: new Date() },
        }),
      );
    } catch (error) {
      this.logger.warn({ organizationId: tenant.organizationId, errorClass: error instanceof Error ? error.name : 'unknown' }, 'brand extraction failed');
    }
  }

  /** Apply the draft. Overwrites only what the draft found; the result counts as extracted. */
  async applyDraft(tenant: TenantContext, requestId: string): Promise<BrandKitView> {
    this.requireAdmin(tenant);
    await withTenant(this.prisma, tenant, async (tx) => {
      const kit = await tx.organizationBrandKit.findUnique({ where: { organizationId: tenant.organizationId } });
      const draft = (kit?.draft ?? null) as StoredDraft | null;
      if (!kit || !draft) throw new UnprocessableEntityException({ code: 'BRAND_NO_DRAFT' });
      await tx.organizationBrandKit.update({
        where: { organizationId: tenant.organizationId },
        data: {
          source: 'EXTRACTED',
          ...(draft.logo ? { logoObjectKey: draft.logo.objectKey, logoContentType: draft.logo.type, logoWidth: draft.logo.width, logoHeight: draft.logo.height } : {}),
          ...(draft.accentColor ? { accentColor: draft.accentColor } : {}),
          ...(draft.primaryColor ? { primaryColor: draft.primaryColor } : {}),
          font: draft.font,
          updatedBy: tenant.userId,
          updatedAt: new Date(),
        },
      });
      // The draft is used up; its logo object is now the kit's logo.
      await tx.$executeRaw`UPDATE organization_brand_kits SET draft = NULL WHERE organization_id = ${tenant.organizationId}::uuid`;
    });
    await this.audit(tenant, 'brand.draft_applied', requestId);
    return this.get(tenant);
  }

  /** An admin's own choices: always win over extraction. */
  async update(tenant: TenantContext, input: { accentColor: string | null; primaryColor: string | null; font: BrandFont }, requestId: string): Promise<BrandKitView> {
    this.requireAdmin(tenant);
    await withTenant(this.prisma, tenant, (tx) =>
      tx.organizationBrandKit.upsert({
        where: { organizationId: tenant.organizationId },
        create: { organizationId: tenant.organizationId, source: 'EDITED', accentColor: input.accentColor, primaryColor: input.primaryColor, font: input.font, updatedBy: tenant.userId },
        update: { source: 'EDITED', accentColor: input.accentColor, primaryColor: input.primaryColor, font: input.font, updatedBy: tenant.userId, updatedAt: new Date() },
      }),
    );
    await this.audit(tenant, 'brand.edited', requestId);
    return this.get(tenant);
  }

  async uploadLogo(tenant: TenantContext, contentBase64: string, requestId: string): Promise<BrandKitView> {
    this.requireAdmin(tenant);
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.length === 0 || bytes.length > LOGO_MAX) throw new UnprocessableEntityException({ code: 'BRAND_LOGO_TOO_LARGE' });
    const sniffed = sniffLogo(bytes);
    if (!sniffed) throw new UnprocessableEntityException({ code: 'BRAND_LOGO_TYPE' });
    const objectKey = `${tenant.organizationId}/brand/logo-${newId()}.${sniffed.type === 'image/svg+xml' ? 'svg' : sniffed.type === 'image/png' ? 'png' : 'jpg'}`;
    await this.store.put(objectKey, new Uint8Array(bytes), { contentType: sniffed.type, sha256: sha256(bytes) });
    const data = { source: 'EDITED', logoObjectKey: objectKey, logoContentType: sniffed.type, logoWidth: sniffed.width, logoHeight: sniffed.height, updatedBy: tenant.userId };
    await withTenant(this.prisma, tenant, (tx) => tx.organizationBrandKit.upsert({ where: { organizationId: tenant.organizationId }, create: { organizationId: tenant.organizationId, ...data }, update: { ...data, updatedAt: new Date() } }));
    await this.audit(tenant, 'brand.logo_uploaded', requestId);
    return this.get(tenant);
  }

  /** Back to the Pactlab kit; the draft is kept, so it can be applied again. */
  async revert(tenant: TenantContext, requestId: string): Promise<BrandKitView> {
    this.requireAdmin(tenant);
    await withTenant(this.prisma, tenant, (tx) =>
      tx.organizationBrandKit.updateMany({
        where: { organizationId: tenant.organizationId },
        data: { source: 'DEFAULT', logoObjectKey: null, logoContentType: null, logoWidth: null, logoHeight: null, accentColor: null, primaryColor: null, font: 'MANROPE', updatedBy: tenant.userId, updatedAt: new Date() },
      }),
    );
    await this.audit(tenant, 'brand.reverted', requestId);
    return this.get(tenant);
  }

  /** The organization's logo, for its members; the draft logo for previews (admins). */
  async logo(tenant: TenantContext, which: 'current' | 'draft'): Promise<{ bytes: Uint8Array; contentType: string }> {
    const kit = await withTenant(this.prisma, tenant, (tx) => tx.organizationBrandKit.findUnique({ where: { organizationId: tenant.organizationId } }));
    const draft = (kit?.draft ?? null) as StoredDraft | null;
    const key = which === 'draft' ? draft?.logo?.objectKey : kit?.logoObjectKey;
    const type = which === 'draft' ? draft?.logo?.type : kit?.logoContentType;
    if (!key || !type) throw new NotFoundException();
    return { bytes: await this.store.get(key), contentType: type };
  }

  /** The sign-in page's brand by slug: name, colors, font and whether there is a logo. Nothing else. */
  async publicBrand(slug: string): Promise<PublicBrandView> {
    const row = await this.publicRow(slug);
    if (!row) throw new NotFoundException();
    const readable = row.accentColor ? readableOnWhite(row.accentColor) : null;
    return { name: row.name, accentColor: row.accentColor, accentReadable: readable?.color ?? null, primaryColor: row.primaryColor, font: row.font as BrandFont, hasLogo: Boolean(row.logoObjectKey) };
  }

  async publicLogo(slug: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const row = await this.publicRow(slug);
    if (!row?.logoObjectKey || !row.logoContentType) throw new NotFoundException();
    return { bytes: await this.store.get(row.logoObjectKey), contentType: row.logoContentType };
  }

  private publicRow(slug: string) {
    return /^[a-z0-9-]{2,80}$/.test(slug) ? publicBrand(this.prisma, slug) : Promise.resolve(null);
  }
}
