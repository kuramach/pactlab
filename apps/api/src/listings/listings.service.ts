import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { PropertyDataError, type PropertyDataProvider } from '@pactlab/connectors';
import { LISTING_MEDIA_LIMITS, type AddListingImageBody, type AddListingVideoBody, type DeclineListingInterestBody, type ListingInterestBody, type ListingInterestView, type ListingMediaView, type ListingPropertyFact, type ListingStatusBody, type ListingView, type PropertyLookupBody, type PublicListingView, type SaveListingBody, type SavePropertyBody } from '@pactlab/contracts';
import { appendAuditEvent, publicListings, withTenant, type Prisma, type PrismaClient } from '@pactlab/db';
import { isCounterpartyRole, newId, permissionsForDealRole, tenantObjectKey, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import type { EmailSender } from '../email-login/email-sender';
import { emails } from '../email-login/emails';
import { keyedHash } from '../email-login/client-address';
import { hashToken } from '../invitations/invitations.service';
import { SALE_FILES, SaleService, type SaleFileDependencies } from '../sale/sale.service';
import { ImageRejectedError, stripImageMetadata } from './strip-image-metadata';
import { parseVideoUrl } from './video-url';
import { PRISMA } from '../tokens';

export const LISTINGS = Symbol('LISTINGS');
export interface ListingDependencies {
  readonly emailSender: EmailSender;
  /** The web app's origin, for the confirmation link. */
  readonly appOrigin: string;
  /** Keys the client-address hash used for rate limits. */
  readonly hashSecret: string;
  /** Property data by address for the page (batch 2): RentCast in the US; the fixture outside production. Null: no lookup. */
  readonly property?: PropertyDataProvider | null;
}

/** The seller's own team runs the page, like the sale process: write access, never a counterparty. */
const canRun = (role: DealRole) => permissionsForDealRole(role).has('DEAL_WRITE') && !isCounterpartyRole(role);
const CONFIRM_DAYS = 7;
const newSlug = () => `pl-${Array.from(randomBytes(10), (byte) => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('')}`;
const iso = (value: Date | null) => (value ? value.toISOString() : null);

type ListingRow = NonNullable<Awaited<ReturnType<PrismaClient['dealListing']['findFirst']>>>;
type InterestRow = NonNullable<Awaited<ReturnType<PrismaClient['listingInterest']['findFirst']>>>;
type MediaRow = { id: string; kind: string; caption: string | null; videoProvider: string | null; videoId: string | null };

function mediaView(row: MediaRow): ListingMediaView {
  return {
    id: row.id,
    kind: row.kind === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    caption: row.caption,
    videoProvider: row.videoProvider === 'YOUTUBE' || row.videoProvider === 'VIMEO' ? row.videoProvider : null,
    videoId: row.videoId,
  };
}

function asking(low: { toString(): string } | string | null, high: { toString(): string } | string | null, currency: string | null) {
  return low !== null && currency ? { low: low.toString(), high: high === null ? null : high.toString(), currency } : null;
}

function listingView(row: ListingRow, media: readonly MediaRow[] = []): ListingView {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status as ListingView['status'],
    visibility: row.visibility as ListingView['visibility'],
    codename: row.codename,
    publicName: row.publicName,
    headline: row.headline,
    sector: row.sector,
    region: row.region,
    sizeBand: row.sizeBand,
    asking: asking(row.askingLow, row.askingHigh, row.askingCurrency),
    summary: row.summary,
    highlights: row.highlights,
    indexable: row.indexable,
    publishedAt: iso(row.publishedAt),
    updatedAt: row.updatedAt.toISOString(),
    media: media.map(mediaView),
    propertyAddress: row.propertyAddress,
    propertyFacts: (Array.isArray(row.propertyFacts) ? row.propertyFacts : []) as unknown as ListingPropertyFact[],
  };
}

function interestView(row: InterestRow): ListingInterestView {
  return {
    id: row.id,
    name: row.name,
    firm: row.firm,
    email: row.email,
    intent: row.intent as ListingInterestView['intent'],
    message: row.message,
    status: row.status as ListingInterestView['status'],
    confirmedAt: iso(row.emailConfirmedAt),
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    bidId: row.bidId,
  };
}

/**
 * Public deal pages. The seller's team writes a teaser and publishes it at an unguessable
 * link; signed-out visitors request access and confirm their email; the seller approves a
 * request, which makes the requester's firm a bidder and invites them — they still sign the
 * NDA before seeing anything beyond the teaser (SaleService rules).
 */
@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(SaleService) private readonly sale: SaleService,
    @Inject(LISTINGS) private readonly deps: ListingDependencies,
    @Inject(SALE_FILES) private readonly files: SaleFileDependencies,
  ) {}

  // ------------------------------------------------------------------ seller

  /** The pact's page, or null before the seller writes one. */
  async get(tenant: TenantContext, dealId: string, requestId: string): Promise<{ listing: ListingView | null }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.viewed', requestId });
    const found = await withTenant(this.prisma, tenant, async (tx) => {
      const row = await tx.dealListing.findFirst({ where: { dealId } });
      return row ? { row, media: await tx.listingMedia.findMany({ where: { listingId: row.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }) } : null;
    });
    return { listing: found ? listingView(found.row, found.media) : null };
  }

  /**
   * Propose facts about the property from its address (batch 2). Nothing is
   * stored: the seller approves each fact, then saves. Never owner names or taxes.
   */
  async lookupProperty(tenant: TenantContext, dealId: string, body: PropertyLookupBody, requestId: string): Promise<{ available: boolean; formattedAddress: string | null; facts: ListingPropertyFact[] }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.property_lookup', requestId });
    const provider = this.deps.property;
    if (!provider || !provider.countries.includes(body.country)) return { available: false, formattedAddress: null, facts: [] };
    try {
      const found = await provider.lookup(body.address, body.country);
      const retrievedAt = new Date().toISOString();
      return { available: true, formattedAddress: found?.formattedAddress ?? null, facts: (found?.facts ?? []).map((fact) => ({ ...fact, retrievedAt })) };
    } catch (error) {
      if (error instanceof PropertyDataError) throw new ServiceUnavailableException({ code: error.kind === 'RATE_LIMITED' ? 'PROPERTY_RATE_LIMITED' : 'PROPERTY_UNAVAILABLE' });
      throw error;
    }
  }

  /** Save the property's address and the facts the seller approved to the page. */
  async saveProperty(tenant: TenantContext, dealId: string, body: SavePropertyBody, requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.property_saved', requestId });
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      const existing = await tx.dealListing.findFirst({ where: { dealId }, select: { id: true } });
      if (!existing) throw new NotFoundException();
      const saved = await tx.dealListing.update({ where: { id: existing.id }, data: { propertyAddress: body.address, propertyFacts: body.facts as unknown as Prisma.InputJsonValue, updatedBy: tenant.userId, updatedAt: new Date() } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.property_saved', targetType: 'deal_listing', targetId: saved.id, outcome: 'SUCCEEDED', requestId });
      return saved;
    });
    return { listing: listingView(row, await this.mediaRows(tenant, row.id)) };
  }

  async save(tenant: TenantContext, dealId: string, body: SaveListingBody, requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.saved', requestId });
    const data = {
      visibility: body.visibility,
      codename: body.codename,
      // An anonymous page never keeps a name to show.
      publicName: body.visibility === 'NAMED' ? body.publicName : null,
      headline: body.headline,
      sector: body.sector,
      region: body.region,
      sizeBand: body.sizeBand,
      askingLow: body.askingLow,
      askingHigh: body.askingLow === null ? null : body.askingHigh,
      askingCurrency: body.askingLow === null ? null : body.askingCurrency,
      summary: body.summary,
      highlights: body.highlights,
      indexable: body.indexable,
      updatedBy: tenant.userId,
      updatedAt: new Date(),
    };
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      const existing = await tx.dealListing.findFirst({ where: { dealId }, select: { id: true } });
      const saved = existing
        ? await tx.dealListing.update({ where: { id: existing.id }, data })
        : await tx.dealListing.create({ data: { ...data, id: newId(), organizationId: tenant.organizationId, dealId, slug: newSlug(), createdBy: tenant.userId } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.saved', targetType: 'deal_listing', targetId: saved.id, outcome: 'SUCCEEDED', requestId });
      return saved;
    });
    return { listing: listingView(row, await this.mediaRows(tenant, row.id)) };
  }

  /** Publish, unpublish (back to draft) or close the page. */
  async setStatus(tenant: TenantContext, dealId: string, body: ListingStatusBody, requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.status_changed', requestId });
    const row = await withTenant(this.prisma, tenant, async (tx) => {
      const existing = await tx.dealListing.findFirst({ where: { dealId } });
      if (!existing) throw new NotFoundException();
      const saved = await tx.dealListing.update({
        where: { id: existing.id },
        data: { status: body.status, publishedAt: body.status === 'PUBLISHED' ? (existing.publishedAt ?? new Date()) : existing.publishedAt, updatedBy: tenant.userId, updatedAt: new Date() },
      });
      const action = body.status === 'PUBLISHED' ? 'listing.published' : body.status === 'CLOSED' ? 'listing.closed' : 'listing.unpublished';
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType: 'deal_listing', targetId: saved.id, outcome: 'SUCCEEDED', requestId });
      return saved;
    });
    return { listing: listingView(row, await this.mediaRows(tenant, row.id)) };
  }

  private mediaRows(tenant: TenantContext, listingId: string) {
    return withTenant(this.prisma, tenant, (tx) => tx.listingMedia.findMany({ where: { listingId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }));
  }

  // ------------------------------------------------------------------ media (seller)

  private async listingFor(tenant: TenantContext, dealId: string) {
    const listing = await withTenant(this.prisma, tenant, (tx) => tx.dealListing.findFirst({ where: { dealId }, select: { id: true } }));
    if (!listing) throw new NotFoundException({ code: 'NO_PAGE' });
    return listing;
  }

  private async nextPosition(tenant: TenantContext, listingId: string, kind: 'IMAGE' | 'VIDEO') {
    return withTenant(this.prisma, tenant, async (tx) => {
      const [count, last] = await Promise.all([tx.listingMedia.count({ where: { listingId, kind } }), tx.listingMedia.findFirst({ where: { listingId }, orderBy: { position: 'desc' }, select: { position: true } })]);
      return { count, position: (last?.position ?? -1) + 1 };
    });
  }

  /**
   * A picture: recognised by its bytes (JPEG, PNG or WebP; never SVG), up to 5 MB, scanned,
   * and stored without metadata (camera, location, comments) — the stripped bytes are what
   * is hashed, stored and ever shown.
   */
  async addImage(tenant: TenantContext, dealId: string, body: AddListingImageBody, requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.media.added', requestId });
    const listing = await this.listingFor(tenant, dealId);
    const raw = new Uint8Array(Buffer.from(body.contentBase64, 'base64'));
    if (raw.length === 0) throw new BadRequestException();
    if (raw.length > LISTING_MEDIA_LIMITS.imageBytes) throw new PayloadTooLargeException();
    let image;
    try {
      image = stripImageMetadata(raw);
    } catch (error) {
      if (error instanceof ImageRejectedError) throw new UnsupportedMediaTypeException({ code: error.reason === 'NOT_AN_IMAGE' ? 'NOT_AN_IMAGE' : 'MALFORMED_IMAGE' });
      throw error;
    }
    const verdict = await this.files.scanner.scan(raw);
    if (verdict === 'UNAVAILABLE') throw new ServiceUnavailableException();
    if (verdict !== 'CLEAN') throw new UnprocessableEntityException({ code: 'MALWARE' });
    const { count, position } = await this.nextPosition(tenant, listing.id, 'IMAGE');
    if (count >= LISTING_MEDIA_LIMITS.images) throw new ConflictException({ code: 'TOO_MANY_IMAGES' });
    const id = newId();
    const sha256 = createHash('sha256').update(image.bytes).digest('hex');
    const objectKey = tenantObjectKey(tenant.organizationId, dealId, 'listing-media', id);
    await this.files.objectStore.put(objectKey, image.bytes, { contentType: image.contentType, sha256 });
    try {
      await withTenant(this.prisma, tenant, async (tx) => {
        await tx.listingMedia.create({
          data: { id, organizationId: tenant.organizationId, dealId, listingId: listing.id, kind: 'IMAGE', position, caption: body.caption, objectKey, contentType: image.contentType, sha256, byteSize: image.bytes.length, createdBy: tenant.userId },
        });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.media.added', targetType: 'listing_media', targetId: id, outcome: 'SUCCEEDED', requestId });
      });
    } catch (error) {
      await this.files.objectStore.delete(objectKey);
      throw error;
    }
    return this.get(tenant, dealId, requestId) as Promise<{ listing: ListingView }>;
  }

  /** A YouTube or Vimeo link, kept only as provider and id. */
  async addVideo(tenant: TenantContext, dealId: string, body: AddListingVideoBody, requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.media.added', requestId });
    const listing = await this.listingFor(tenant, dealId);
    const video = parseVideoUrl(body.url);
    if (!video) throw new UnprocessableEntityException({ code: 'UNSUPPORTED_VIDEO_LINK' });
    const { count, position } = await this.nextPosition(tenant, listing.id, 'VIDEO');
    if (count >= LISTING_MEDIA_LIMITS.videos) throw new ConflictException({ code: 'TOO_MANY_VIDEOS' });
    const id = newId();
    await withTenant(this.prisma, tenant, async (tx) => {
      await tx.listingMedia.create({ data: { id, organizationId: tenant.organizationId, dealId, listingId: listing.id, kind: 'VIDEO', position, caption: body.caption, videoProvider: video.provider, videoId: video.id, createdBy: tenant.userId } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.media.added', targetType: 'listing_media', targetId: id, outcome: 'SUCCEEDED', requestId });
    });
    return this.get(tenant, dealId, requestId) as Promise<{ listing: ListingView }>;
  }

  async captionMedia(tenant: TenantContext, dealId: string, mediaId: string, caption: string | null, requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.media.updated', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const { count } = await tx.listingMedia.updateMany({ where: { id: mediaId, dealId }, data: { caption } });
      if (count === 0) throw new NotFoundException();
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.media.updated', targetType: 'listing_media', targetId: mediaId, outcome: 'SUCCEEDED', requestId });
    });
    return this.get(tenant, dealId, requestId) as Promise<{ listing: ListingView }>;
  }

  /** The page's media in the given order; the list must name every item once. */
  async orderMedia(tenant: TenantContext, dealId: string, ids: readonly string[], requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.media.ordered', requestId });
    await withTenant(this.prisma, tenant, async (tx) => {
      const current = await tx.listingMedia.findMany({ where: { dealId }, select: { id: true } });
      const known = new Set(current.map((item) => item.id));
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) throw new UnprocessableEntityException({ code: 'ORDER_MISMATCH' });
      for (const [position, id] of ids.entries()) await tx.listingMedia.update({ where: { id }, data: { position } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.media.ordered', targetType: 'deal_listing', targetId: dealId, outcome: 'SUCCEEDED', requestId });
    });
    return this.get(tenant, dealId, requestId) as Promise<{ listing: ListingView }>;
  }

  /** Remove a picture (and its stored file) or a video link. */
  async removeMedia(tenant: TenantContext, dealId: string, mediaId: string, requestId: string): Promise<{ listing: ListingView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.media.removed', requestId });
    const removed = await withTenant(this.prisma, tenant, async (tx) => {
      const found = await tx.listingMedia.findFirst({ where: { id: mediaId, dealId }, select: { id: true, objectKey: true } });
      if (!found) throw new NotFoundException();
      await tx.listingMedia.delete({ where: { id: found.id } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.media.removed', targetType: 'listing_media', targetId: mediaId, outcome: 'SUCCEEDED', requestId });
      return found;
    });
    if (removed.objectKey) {
      await this.files.objectStore.delete(removed.objectKey).catch((error: unknown) => {
        this.logger.error({ requestId, errorClass: error instanceof Error ? error.name : 'unknown' }, 'listing image delete failed');
      });
    }
    return this.get(tenant, dealId, requestId) as Promise<{ listing: ListingView }>;
  }

  /** The seller's own picture (also while the page is a draft), hash re-checked. */
  async ownImage(tenant: TenantContext, dealId: string, mediaId: string, requestId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.media.viewed', requestId });
    const found = await withTenant(this.prisma, tenant, (tx) => tx.listingMedia.findFirst({ where: { id: mediaId, dealId, kind: 'IMAGE' } }));
    if (!found?.objectKey || !found.contentType) throw new NotFoundException();
    const bytes = await this.read(found.objectKey);
    if (createHash('sha256').update(bytes).digest('hex') !== found.sha256) throw new ConflictException();
    return { bytes, contentType: found.contentType };
  }

  private async read(objectKey: string): Promise<Uint8Array> {
    try {
      return await this.files.objectStore.get(objectKey);
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  /** Confirmed requests, newest first. Unconfirmed ones never reach the seller. */
  async interests(tenant: TenantContext, dealId: string, requestId: string): Promise<{ items: ListingInterestView[] }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.interests_viewed', requestId });
    const rows = await withTenant(this.prisma, tenant, (tx) => tx.listingInterest.findMany({ where: { dealId, status: { not: 'PENDING_EMAIL' } }, orderBy: { createdAt: 'desc' } }));
    return { items: rows.map(interestView) };
  }

  /**
   * Approve: the requester's firm becomes a bidder (an existing one is reused) and they are
   * invited to bid. Idempotent: approving again changes nothing.
   */
  async approve(tenant: TenantContext, dealId: string, interestId: string, requestId: string): Promise<{ interest: ListingInterestView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.interest.approved', requestId });
    const { interest, codename, anonymous } = await withTenant(this.prisma, tenant, async (tx) => {
      const found = await tx.listingInterest.findFirst({ where: { id: interestId, dealId, status: { not: 'PENDING_EMAIL' } } });
      if (!found) throw new NotFoundException();
      const listing = await tx.dealListing.findFirst({ where: { dealId }, select: { codename: true, visibility: true } });
      return { interest: found, codename: listing?.codename ?? 'the pact', anonymous: listing?.visibility !== 'NAMED' };
    });
    if (interest.status === 'APPROVED') return { interest: interestView(interest) };
    if (interest.status === 'DECLINED') throw new ConflictException({ code: 'ALREADY_DECLINED' });

    const bidId = await this.bidFor(tenant, dealId, interest.firm, requestId);
    try {
      // Before the NDA, an anonymous page's buyer learns only the codename.
      await this.sale.inviteToBid(tenant, dealId, bidId, { email: interest.email }, requestId, anonymous ? { dealLabel: codename } : {});
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      // Already invited (another request from the same person): the approval still stands.
    }
    const saved = await withTenant(this.prisma, tenant, async (tx) => {
      const updated = await tx.listingInterest.update({ where: { id: interest.id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedBy: tenant.userId, bidId } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.interest.approved', targetType: 'listing_interest', targetId: interest.id, outcome: 'SUCCEEDED', requestId });
      return updated;
    });
    return { interest: interestView(saved) };
  }

  async decline(tenant: TenantContext, dealId: string, interestId: string, body: DeclineListingInterestBody, requestId: string): Promise<{ interest: ListingInterestView }> {
    await this.access.require(tenant, dealId, canRun, { action: 'listing.interest.declined', requestId });
    const { saved, codename, notify } = await withTenant(this.prisma, tenant, async (tx) => {
      const found = await tx.listingInterest.findFirst({ where: { id: interestId, dealId, status: { not: 'PENDING_EMAIL' } } });
      if (!found) throw new NotFoundException();
      if (found.status === 'APPROVED') throw new ConflictException({ code: 'ALREADY_APPROVED' });
      const listing = await tx.dealListing.findFirst({ where: { dealId }, select: { codename: true } });
      if (found.status === 'DECLINED') return { saved: found, codename: listing?.codename ?? 'the pact', notify: false };
      const updated = await tx.listingInterest.update({ where: { id: found.id }, data: { status: 'DECLINED', decidedAt: new Date(), decidedBy: tenant.userId, decisionNote: body.note } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'listing.interest.declined', targetType: 'listing_interest', targetId: found.id, outcome: 'SUCCEEDED', requestId });
      return { saved: updated, codename: listing?.codename ?? 'the pact', notify: true };
    });
    if (notify) this.send(emails.listingInterestDeclined(saved.email, { codename, note: saved.decisionNote }), requestId);
    return { interest: interestView(saved) };
  }

  /** The bid for a requester's firm: the existing one with that name, or a new one. */
  private async bidFor(tenant: TenantContext, dealId: string, firm: string, requestId: string): Promise<string> {
    const existing = await withTenant(this.prisma, tenant, (tx) => tx.bid.findFirst({ where: { dealId, firmName: { equals: firm, mode: 'insensitive' } }, select: { id: true } }));
    if (existing) return existing.id;
    try {
      return (await this.sale.addBid(tenant, dealId, { firmName: firm }, requestId)).id;
    } catch (error) {
      if (error instanceof ConflictException && (error.getResponse() as { code?: string }).code === 'PROCESS_CLOSED') throw new UnprocessableEntityException({ code: 'PROCESS_CLOSED' });
      throw error;
    }
  }

  // ------------------------------------------------------------------ public (signed out)

  async publicView(slug: string): Promise<PublicListingView> {
    const row = await publicListings.get(this.prisma, slug);
    if (!row) throw new NotFoundException();
    return {
      slug: row.slug,
      visibility: row.visibility,
      codename: row.codename,
      publicName: row.publicName,
      headline: row.headline,
      sector: row.sector,
      region: row.region,
      sizeBand: row.sizeBand,
      asking: asking(row.askingLow, row.askingHigh, row.askingCurrency),
      summary: row.summary,
      highlights: row.highlights,
      indexable: row.indexable,
      publishedAt: iso(row.publishedAt),
      media: (await publicListings.media(this.prisma, slug)).map(mediaView),
      propertyAddress: row.propertyAddress,
      propertyFacts: row.propertyFacts,
    };
  }

  /** One picture of a published page, for anyone with the link. */
  async publicImage(slug: string, mediaId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const image = await publicListings.image(this.prisma, slug, mediaId);
    if (!image) throw new NotFoundException();
    return { bytes: await this.read(image.objectKey), contentType: image.contentType };
  }

  /**
   * Leave a request. The answer is the same whether it was recorded, refused by a rate
   * limit, a duplicate, or tripped the honeypot: "check your email".
   */
  async requestAccess(slug: string, body: ListingInterestBody, address: string): Promise<{ status: 'CHECK_EMAIL' }> {
    if (body.website) return { status: 'CHECK_EMAIL' };
    const listing = await publicListings.get(this.prisma, slug);
    if (!listing) throw new NotFoundException();
    const token = randomBytes(32).toString('base64url');
    const recorded = await publicListings.fileInterest(this.prisma, {
      slug,
      name: body.name,
      firm: body.firm,
      email: body.email,
      intent: body.intent,
      message: body.message,
      ipHash: keyedHash(this.deps.hashSecret, `listing-ip:${address}`),
      tokenHash: hashToken(token),
    });
    if (recorded) {
      const link = new URL(`/listings/confirm/${token}`, this.deps.appOrigin).toString();
      this.send(emails.listingInterestConfirm(body.email, { codename: listing.codename, link, days: CONFIRM_DAYS }), 'listing-interest');
    }
    return { status: 'CHECK_EMAIL' };
  }

  async confirm(token: string): Promise<{ slug: string }> {
    const slug = await publicListings.confirmInterest(this.prisma, hashToken(token));
    if (!slug) throw new NotFoundException();
    return { slug };
  }

  private send(message: Parameters<EmailSender['send']>[0], requestId: string) {
    void this.deps.emailSender.send(message).catch((error: unknown) => {
      // Never log the address or the link.
      this.logger.error({ requestId, errorClass: error instanceof Error ? error.name : 'unknown' }, 'listing email delivery failed');
    });
  }
}
