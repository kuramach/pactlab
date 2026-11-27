import { Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { RENT_ROLL_UNIT } from '@pactlab/calculations';
import { PropertyDataError, type PropertyPhoto, type PropertyPhotoImage, type PropertyPhotoProvider, type PropertyRecordProvider } from '@pactlab/connectors';
import { appendAuditEvent, withTenant, type Prisma, type PrismaClient, type TransactionClient } from '@pactlab/db';
import {
  addressCountry,
  contradictionsWithRentRoll,
  isBuyerSideRole,
  newId,
  NOT_IN_RECORD,
  NOT_PUBLISHED,
  permissionsForDealRole,
  profileFields,
  REFERENCE_DATA_LABEL,
  rentRollTotals,
  type DealRole,
  type FieldProvenance,
  type ProfileContradiction,
  type ProfileField,
  type TenantContext,
} from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { loadPackEvidence } from '../packs/pack-evidence';
import { PRISMA } from '../tokens';
import type { AcceptBody } from './property-profile.schemas';

export const PROPERTY_RECORD_PROVIDER = Symbol('PROPERTY_RECORD_PROVIDER');
export const PROPERTY_PHOTO_PROVIDER = Symbol('PROPERTY_PHOTO_PROVIDER');

/** The profile is buyer analysis (it holds the owner of record): never a counterparty. */
const canRead = (role: DealRole) => isBuyerSideRole(role) && permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
/** Fetching spends provider calls and accepting changes pact data. */
const canRun = (role: DealRole) => canRead(role) && permissionsForDealRole(role).has('DEAL_WRITE');

const US_ONLY = 'Public-record property data covers US addresses only (RentCast). For this address the profile stays manual and import-driven.';

interface AcceptedValue {
  value: string;
  status: 'PRESENT';
  /** RECORD: as the public record gave it (the reviewer kept it); EDITED: changed by the reviewer; ENTERED: typed where the record had nothing. */
  basis: 'RECORD' | 'EDITED' | 'ENTERED';
  /** The record's provenance, kept even on an edit (the proposal it came from); null when entered by hand. */
  provenance: FieldProvenance | null;
}

export interface PropertyPhotoView extends Omit<PropertyPhoto, 'ref'> {
  index: number;
}

export interface PropertyProfileView {
  /** The pact is a multifamily pact; any other pack has no profile. */
  address: string | null;
  addressFrom: 'PACT' | 'LISTING' | null;
  /** Whether metadata can be fetched for the address: US only. */
  metadata: { offered: boolean; note: string | null; available: boolean; source: string | null };
  photos: { available: boolean; source: string | null; items: PropertyPhotoView[]; placeName: string | null; fetchedAt: string | null; offered: boolean };
  referenceLabel: string;
  status: 'EMPTY' | 'PROPOSED' | 'ACCEPTED';
  proposed: ProfileField[];
  proposedFetchedAt: string | null;
  accepted: Record<string, AcceptedValue>;
  acceptedAt: string | null;
  contradictions: ProfileContradiction[];
}

const today = () => new Date().toISOString();

/**
 * The multifamily property profile (T-188, ADR 0062): a public record proposes the profile from the address, a
 * person reviews, edits and accepts it, and accepted values are pact data with provenance. A record never overrides
 * a seller document: contradictions with the rent roll become claims (finding inputs), not overwrites. Photos are
 * illustrative references (Street View + Places), never evidence. Reads of the profile (owner data) are audited.
 */
@Injectable()
export class PropertyProfileService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
    @Inject(PROPERTY_RECORD_PROVIDER) private readonly records: PropertyRecordProvider | null,
    @Inject(PROPERTY_PHOTO_PROVIDER) private readonly photoSource: PropertyPhotoProvider | null,
  ) {}

  async view(tenant: TenantContext, dealId: string, requestId: string): Promise<PropertyProfileView> {
    await this.access.require(tenant, dealId, canRead, { action: 'property_profile.viewed', requestId });
    return withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMultifamily(tx, dealId);
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'property_profile.viewed', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId });
      return this.build(tx, dealId);
    });
  }

  async populate(tenant: TenantContext, dealId: string, address: string | null, requestId: string): Promise<PropertyProfileView> {
    await this.access.require(tenant, dealId, canRun, { action: 'property_profile.populated', requestId });
    const known = await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMultifamily(tx, dealId);
      return this.addressOf(tx, dealId);
    });
    const target = address ?? known.address;
    if (!target) throw new UnprocessableEntityException({ code: 'PROPERTY_ADDRESS_NEEDED' });
    // Non-US: no population attempt, the honest explanation instead.
    if (addressCountry(target) !== 'US') throw new UnprocessableEntityException({ code: 'METADATA_US_ONLY', message: US_ONLY });
    const provider = this.records;
    if (!provider) throw new ServiceUnavailableException({ code: 'PROPERTY_RECORD_OFF' });

    let record;
    try {
      record = await provider.fetchRecord(target);
    } catch (error) {
      await this.auditCall(tenant, dealId, 'property_profile.record_fetched', 'FAILED', requestId);
      if (error instanceof PropertyDataError) throw new ServiceUnavailableException({ code: error.kind === 'RATE_LIMITED' ? 'PROPERTY_RECORD_RATE_LIMITED' : error.kind === 'AUTH' ? 'PROPERTY_RECORD_KEY_REFUSED' : 'PROPERTY_RECORD_UNAVAILABLE' });
      throw error;
    }
    await this.auditCall(tenant, dealId, 'property_profile.record_fetched', 'SUCCEEDED', requestId);
    if (!record) throw new UnprocessableEntityException({ code: 'NO_PUBLIC_RECORD' });
    const fetchedAt = today();
    const fields = profileFields(record, fetchedAt);

    return withTenant(this.prisma, tenant, async (tx) => {
      if (address !== null && address !== known.address) {
        await tx.deal.updateMany({ where: { id: dealId }, data: { propertyAddress: address } });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'deal.property_address_set', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId });
      }
      const existing = await tx.dealPropertyProfile.findFirst({ where: { dealId }, select: { id: true, status: true } });
      const data = { address: target, proposed: fields as unknown as Prisma.InputJsonValue, recordSource: provider.name, recordVersion: provider.version, recordFetchedAt: new Date(fetchedAt), updatedBy: tenant.userId, updatedAt: new Date() };
      if (existing) await tx.dealPropertyProfile.update({ where: { id: existing.id }, data: { ...data, status: existing.status === 'ACCEPTED' ? 'ACCEPTED' : 'PROPOSED', version: { increment: 1 } } });
      else await tx.dealPropertyProfile.create({ data: { ...data, id: newId(), organizationId: tenant.organizationId, dealId, status: 'PROPOSED' } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'property_profile.populated', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId });
      return this.build(tx, dealId);
    });
  }

  async accept(tenant: TenantContext, dealId: string, body: AcceptBody, requestId: string): Promise<PropertyProfileView> {
    await this.access.require(tenant, dealId, canRun, { action: 'property_profile.accepted', requestId });
    const view = await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMultifamily(tx, dealId);
      const row = await tx.dealPropertyProfile.findFirst({ where: { dealId } });
      if (!row) throw new UnprocessableEntityException({ code: 'PROFILE_NOT_STARTED' });
      const proposed = new Map((row.proposed as unknown as ProfileField[]).map((field) => [field.key, field]));
      const accepted = { ...(row.accepted as unknown as Record<string, AcceptedValue>) };
      for (const { key, value } of body.values) {
        // Never accept the absence text as a value: a missing field stays missing unless a person enters one.
        if (value === NOT_IN_RECORD || value === NOT_PUBLISHED) throw new UnprocessableEntityException({ code: 'ABSENCE_IS_NOT_A_VALUE', key });
        const field = proposed.get(key);
        const present = field?.status === 'PRESENT';
        const basis = !present ? 'ENTERED' : value === field.value ? 'RECORD' : 'EDITED';
        accepted[key] = { value, status: 'PRESENT', basis, provenance: present ? field.provenance : null };
      }
      await tx.dealPropertyProfile.update({ where: { id: row.id }, data: { accepted: accepted as unknown as Prisma.InputJsonValue, status: 'ACCEPTED', acceptedBy: tenant.userId, acceptedAt: new Date(), updatedBy: tenant.userId, updatedAt: new Date(), version: { increment: 1 } } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'property_profile.accepted', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId });
      return this.build(tx, dealId);
    });
    // A contradiction with an imported document surfaces right away; the document keeps its value.
    await this.recordContradictions(tenant, dealId, view.contradictions, requestId);
    return view;
  }

  async check(tenant: TenantContext, dealId: string, requestId: string): Promise<PropertyProfileView & { claims: number }> {
    await this.access.require(tenant, dealId, canRun, { action: 'property_profile.checked', requestId });
    const view = await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMultifamily(tx, dealId);
      return this.build(tx, dealId);
    });
    const claims = await this.recordContradictions(tenant, dealId, view.contradictions, requestId);
    return { ...view, claims };
  }

  async refreshPhotos(tenant: TenantContext, dealId: string, requestId: string): Promise<PropertyProfileView> {
    await this.access.require(tenant, dealId, canRun, { action: 'property_profile.photos_fetched', requestId });
    const known = await withTenant(this.prisma, tenant, async (tx) => {
      await this.requireMultifamily(tx, dealId);
      return this.addressOf(tx, dealId);
    });
    if (!known.address) throw new UnprocessableEntityException({ code: 'PROPERTY_ADDRESS_NEEDED' });
    const provider = this.photoSource;
    if (!provider) throw new ServiceUnavailableException({ code: 'PROPERTY_PHOTOS_OFF' });
    let set;
    try {
      set = await provider.photos(known.address);
    } catch (error) {
      await this.auditCall(tenant, dealId, 'property_profile.photos_fetched', 'FAILED', requestId);
      if (error instanceof PropertyDataError) throw new ServiceUnavailableException({ code: error.kind === 'RATE_LIMITED' ? 'PROPERTY_PHOTOS_RATE_LIMITED' : error.kind === 'AUTH' ? 'PROPERTY_PHOTOS_KEY_REFUSED' : 'PROPERTY_PHOTOS_UNAVAILABLE' });
      throw error;
    }
    return withTenant(this.prisma, tenant, async (tx) => {
      const data = { photos: set.photos as unknown as Prisma.InputJsonValue, photosSource: provider.name, photosPlaceName: set.placeName, photosFetchedAt: new Date(), updatedBy: tenant.userId, updatedAt: new Date() };
      const existing = await tx.dealPropertyProfile.findFirst({ where: { dealId }, select: { id: true } });
      if (existing) await tx.dealPropertyProfile.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
      else await tx.dealPropertyProfile.create({ data: { ...data, id: newId(), organizationId: tenant.organizationId, dealId, address: known.address as string, status: 'EMPTY' } });
      await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'property_profile.photos_fetched', targetType: 'deal', targetId: dealId, outcome: 'SUCCEEDED', requestId });
      return this.build(tx, dealId);
    });
  }

  /** One stored photo's bytes: looked up by position in the pact's own gallery, never by a caller-supplied reference. */
  async photoImage(tenant: TenantContext, dealId: string, index: number, requestId: string): Promise<PropertyPhotoImage> {
    await this.access.require(tenant, dealId, canRead, { action: 'property_profile.photo_read', requestId });
    const provider = this.photoSource;
    if (!provider) throw new NotFoundException();
    const photos = await withTenant(this.prisma, tenant, async (tx) => ((await tx.dealPropertyProfile.findFirst({ where: { dealId }, select: { photos: true } }))?.photos ?? []) as unknown as PropertyPhoto[]);
    const photo = photos[index];
    if (!photo) throw new NotFoundException();
    try {
      const image = await provider.image(photo.ref);
      if (!image) throw new NotFoundException();
      return image;
    } catch (error) {
      if (error instanceof PropertyDataError) throw new ServiceUnavailableException({ code: 'PROPERTY_PHOTOS_UNAVAILABLE' });
      throw error;
    }
  }

  private async requireMultifamily(tx: TransactionClient, dealId: string) {
    const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { parties: { where: { role: 'SELLER' }, select: { companyType: true } } } });
    if (!deal) throw new NotFoundException();
    if (deal.parties[0]?.companyType !== 'MULTIFAMILY') throw new UnprocessableEntityException({ code: 'NOT_MULTIFAMILY', message: 'The property profile is part of the multifamily pack' });
  }

  private async addressOf(tx: TransactionClient, dealId: string): Promise<{ address: string | null; addressFrom: 'PACT' | 'LISTING' | null }> {
    const deal = await tx.deal.findFirst({ where: { id: dealId }, select: { propertyAddress: true } });
    if (deal?.propertyAddress) return { address: deal.propertyAddress, addressFrom: 'PACT' };
    const listing = await tx.dealListing.findFirst({ where: { dealId }, select: { propertyAddress: true } });
    return listing?.propertyAddress ? { address: listing.propertyAddress, addressFrom: 'LISTING' } : { address: null, addressFrom: null };
  }

  private async build(tx: TransactionClient, dealId: string): Promise<PropertyProfileView> {
    const [{ address, addressFrom }, row] = await Promise.all([this.addressOf(tx, dealId), tx.dealPropertyProfile.findFirst({ where: { dealId } })]);
    const accepted = (row?.accepted ?? {}) as unknown as Record<string, AcceptedValue>;
    const units = await loadPackEvidence(tx, dealId, [RENT_ROLL_UNIT]);
    const values = Object.fromEntries(Object.entries(accepted).map(([key, entry]) => [key, entry.value]));
    const contradictions = units.length ? contradictionsWithRentRoll(values, rentRollTotals(units.map((unit) => unit.canonical['sqft'] ?? null))) : [];
    const country = address ? addressCountry(address) : null;
    const photos = ((row?.photos ?? []) as unknown as PropertyPhoto[]).map(({ ref: _ref, ...rest }, index) => ({ ...rest, index }));
    return {
      address,
      addressFrom,
      metadata: { offered: country !== 'OTHER', note: country === 'OTHER' ? US_ONLY : null, available: this.records !== null, source: this.records?.name ?? null },
      photos: { available: this.photoSource !== null, offered: this.photoSource !== null, source: row?.photosSource ?? this.photoSource?.name ?? null, items: photos, placeName: row?.photosPlaceName ?? null, fetchedAt: row?.photosFetchedAt?.toISOString() ?? null },
      referenceLabel: REFERENCE_DATA_LABEL,
      status: (row?.status ?? 'EMPTY') as PropertyProfileView['status'],
      proposed: (row?.proposed ?? []) as unknown as ProfileField[],
      proposedFetchedAt: row?.recordFetchedAt?.toISOString() ?? null,
      accepted,
      acceptedAt: row?.acceptedAt?.toISOString() ?? null,
      contradictions,
    };
  }

  /** Each contradiction as a claim (origin PACK_RULE, status CONTRADICTED): the same claims-vs-evidence pattern as the pack's other checks. Idempotent by statement. */
  private async recordContradictions(tenant: TenantContext, dealId: string, contradictions: readonly ProfileContradiction[], requestId: string): Promise<number> {
    let written = 0;
    for (const found of contradictions) {
      await withTenant(this.prisma, tenant, async (tx) => {
        const units = await loadPackEvidence(tx, dealId, [RENT_ROLL_UNIT]);
        const evidenceItemIds = units.slice(0, 200).map((unit) => unit.id);
        const existing = await tx.dealClaim.findFirst({ where: { dealId, origin: 'PACK_RULE', statement: found.statement } });
        if (existing && existing.status === 'CONTRADICTED' && existing.rationale === found.rationale) return;
        const row = existing
          ? await tx.dealClaim.update({ where: { id: existing.id }, data: { status: 'CONTRADICTED', rationale: found.rationale, evidenceItemIds, version: { increment: 1 }, updatedBy: tenant.userId, updatedAt: new Date() } })
          : await tx.dealClaim.create({
              data: { organizationId: tenant.organizationId, dealId, statement: found.statement, source: `Property profile (${REFERENCE_DATA_LABEL}) against the imported rent roll`, origin: 'PACK_RULE', status: 'CONTRADICTED', rationale: found.rationale, evidenceItemIds, findingIds: [], createdBy: tenant.userId, updatedBy: tenant.userId },
            });
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: existing ? 'claim.updated' : 'claim.created', targetType: 'deal_claim', targetId: row.id, outcome: 'SUCCEEDED', requestId });
        written += 1;
      });
    }
    return written;
  }

  /** One audited event per provider call: the metering record for the pay-as-you-go sources. */
  private async auditCall(tenant: TenantContext, dealId: string, action: string, outcome: 'SUCCEEDED' | 'FAILED', requestId: string) {
    await withTenant(this.prisma, tenant, (tx) => appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action, targetType: 'deal', targetId: dealId, outcome, requestId }));
  }
}
