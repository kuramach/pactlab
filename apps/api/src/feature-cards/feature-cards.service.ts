import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import { PRISMA } from '../tokens';
import { arrangeFeatureCards, FEATURE_CARDS, type FeatureCardDefinition, type FeatureCardsView, type FeatureCardState } from './feature-cards';

/**
 * Feature cards (T-155): what is new, per person. A dismissal and a read are stored for the user
 * (never the organization) by card version, so a new version comes back on its own.
 */
@Injectable()
export class FeatureCardsService {
  private readonly cards: readonly FeatureCardDefinition[] = FEATURE_CARDS;

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(tenant: TenantContext): Promise<FeatureCardsView> {
    // bounded: one row per registry card per user, and the registry is a short list in code.
    const rows = await withTenant(this.prisma, tenant, (tx) => tx.userFeatureCard.findMany({ where: { userId: tenant.userId }, take: 500 }));
    const states = new Map<string, FeatureCardState>(rows.map((row) => [row.cardId, { dismissedVersion: row.dismissedVersion, readVersion: row.readVersion }]));
    return arrangeFeatureCards(this.cards, states);
  }

  /** Dismiss the card at its current version; a later version shows it again. Idempotent. */
  async dismiss(tenant: TenantContext, cardId: string): Promise<FeatureCardsView> {
    const card = this.cards.find((candidate) => candidate.id === cardId);
    if (!card) throw new NotFoundException();
    await withTenant(this.prisma, tenant, async (tx) => {
      const current = await tx.userFeatureCard.findUnique({ where: { userId_cardId: { userId: tenant.userId, cardId } } });
      const dismissedVersion = Math.max(current?.dismissedVersion ?? 0, card.version);
      await tx.userFeatureCard.upsert({
        where: { userId_cardId: { userId: tenant.userId, cardId } },
        create: { userId: tenant.userId, cardId, dismissedVersion },
        update: { dismissedVersion, updatedAt: new Date() },
      });
    });
    return this.list(tenant);
  }

  /** The person opened the icon's list: every card in it is read. Idempotent. */
  async markTrayRead(tenant: TenantContext): Promise<FeatureCardsView> {
    const before = await this.list(tenant);
    const unread = before.tray.filter((card) => card.unread);
    await withTenant(this.prisma, tenant, async (tx) => {
      for (const card of unread) {
        await tx.userFeatureCard.upsert({
          where: { userId_cardId: { userId: tenant.userId, cardId: card.id } },
          create: { userId: tenant.userId, cardId: card.id, readVersion: card.version },
          update: { readVersion: card.version, updatedAt: new Date() },
        });
      }
    });
    return this.list(tenant);
  }
}
