import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { BillingSignatureError, FixtureBillingProvider, type BillingEvent, type BillingProvider } from '@pactlab/connectors';
import type { AdminBillingAccountView, BillingPlanKey, BillingPlanView, BillingView, CreatePromoCodeInput, PromoCheckView, PromoCodeView } from '@pactlab/contracts';
import { appendAuditEvent, billing, OperatorRequiredError, promoCodes, withTenant, type BillingPlanRow, type PactCreditKind, type PrismaClient, type PromoCodeRow } from '@pactlab/db';
import { COMPANY_TYPE_LABELS, type CompanyType, type TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { keyedHash } from '../email-login/client-address';
import { LOGGER, PRISMA } from '../tokens';

export const BILLING = Symbol('BILLING');

export interface BillingDependencies {
  readonly provider: BillingProvider;
  /** BILLING_ENFORCEMENT: when false, starting a pact is never gated (credits still count). */
  readonly enforce: boolean;
  /** STRIPE_AUTOMATIC_TAX, decided with a CPA before go-live. */
  readonly automaticTax: boolean;
  /** The web origin, for Checkout and Portal return URLs. */
  readonly appOrigin: string;
  /** Keys the promo-check address hashes. */
  readonly hashSecret: string;
}

const money = (amount: string, currency: string) => ({ amount, currency });

/** "2 free pacts (Multifamily)", "50% off for 12 months", "USD 500 off once". */
export function promoSummary(code: { kind: 'DISCOUNT' | 'FREE_PACTS' | null; freePacts: number | null; packs: readonly string[]; percentOff: string | null; amountOff: string | null; currency: string | null; duration?: string | null; durationMonths?: number | null }): string {
  if (code.kind === 'FREE_PACTS') {
    const packs = code.packs.length > 0 ? ` (${code.packs.map((pack) => COMPANY_TYPE_LABELS[pack as CompanyType] ?? pack).join(', ')})` : '';
    return `${code.freePacts} free pact${code.freePacts === 1 ? '' : 's'}${packs}`;
  }
  const off = code.percentOff ? `${Number(code.percentOff)}% off` : `${code.currency} ${code.amountOff} off`;
  const span = code.duration === 'FOREVER' ? ' for as long as you subscribe' : code.duration === 'REPEATING' ? ` for ${code.durationMonths} months` : code.duration === 'ONCE' ? ' once' : '';
  return `${off}${span}`;
}

/**
 * Billing (T-087, ADR 0025). Stripe is the source of truth for money: access is granted only
 * from a verified Stripe event, never from a browser redirect, and every handler is
 * idempotent so Stripe's retries and replays change nothing. Pactlab holds no card data.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(BILLING) private readonly deps: BillingDependencies,
  ) {}

  get enforced(): boolean {
    return this.deps.enforce;
  }

  get fixture(): boolean {
    return this.deps.provider.name === 'FIXTURE';
  }

  /** The fixture provider, when this environment uses it (never in production). */
  fixtureProvider(): FixtureBillingProvider | null {
    return this.deps.provider instanceof FixtureBillingProvider ? this.deps.provider : null;
  }

  private planView(plan: BillingPlanRow): BillingPlanView {
    return {
      key: plan.key as BillingPlanKey,
      name: plan.display.name,
      summary: plan.display.summary,
      price: { ...money(plan.amount, plan.currency), interval: plan.interval },
      pactsIncluded: plan.pactsIncluded,
      overage: plan.overageAmount ? money(plan.overageAmount, plan.currency) : null,
      grants: plan.grants,
    };
  }

  private async audit(tenant: TenantContext, action: string, target: string): Promise<void> {
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, { organizationId: tenant.organizationId, actorUserId: tenant.userId, action, targetType: 'billing_account', targetId: target, outcome: 'SUCCEEDED' }),
    );
  }

  private static admin(tenant: TenantContext): void {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
  }

  async view(tenant: TenantContext): Promise<BillingView> {
    const [state, plans] = await Promise.all([billing.state(this.prisma, tenant.organizationId, tenant.userId), billing.plans(this.prisma)]);
    if (!state) throw new NotFoundException();
    const plan = plans.find((entry) => entry.key === state.planKey) ?? null;
    return {
      status: state.status,
      pilot: state.pilot,
      plan: plan ? { key: plan.key, name: plan.display.name } : null,
      periodEnd: state.periodEnd?.toISOString() ?? null,
      allowanceLeft: state.status === 'ACTIVE' && state.pactsIncluded !== null ? Math.max(0, state.pactsIncluded - state.pactsUsed) : null,
      credits: state.credits,
      pendingPromo: state.pendingPromo,
      enforced: this.deps.enforce,
      canManage: tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN',
      hasCustomer: state.stripeCustomerId !== null,
      plans: plans.filter((entry) => entry.selfServe).map((entry) => this.planView(entry)),
    };
  }

  /** A hosted Checkout for a self-serve plan (org admins). */
  async checkout(tenant: TenantContext, planKey: BillingPlanKey, email: string | null): Promise<{ url: string }> {
    BillingService.admin(tenant);
    const plan = (await billing.plans(this.prisma)).find((entry) => entry.key === planKey && entry.selfServe);
    if (!plan) throw new UnprocessableEntityException({ code: 'PLAN_NOT_AVAILABLE' });
    // The fixture needs no Stripe price; a real Stripe account needs one set by the ops script.
    const priceId = plan.stripePriceId ?? (this.fixture ? `price_fixture_${plan.key}` : null);
    if (!priceId) throw new ServiceUnavailableException({ code: 'BILLING_NOT_CONFIGURED' });
    const state = await billing.state(this.prisma, tenant.organizationId, tenant.userId);
    const promotionCodeId = await billing.checkoutDiscount(this.prisma, tenant.organizationId, plan.key);
    const back = new URL('/settings', this.deps.appOrigin);
    back.hash = 'billing';
    const done = new URL(back);
    done.searchParams.set('billing', 'returned');
    const session = await this.deps.provider.createCheckout({
      organizationId: tenant.organizationId,
      planKey: plan.key,
      priceId,
      mode: plan.kind === 'SUBSCRIPTION' ? 'subscription' : 'payment',
      customerId: state?.stripeCustomerId ?? null,
      email,
      promotionCodeId,
      successUrl: done.toString(),
      cancelUrl: back.toString(),
      automaticTax: this.deps.automaticTax,
    });
    if (session.customerId) await billing.linkCustomer(this.prisma, tenant.organizationId, session.customerId);
    await this.audit(tenant, 'billing.checkout_started', plan.key);
    return { url: session.url };
  }

  /** Stripe's hosted Customer Portal: invoices, card, plan changes, cancellation. */
  async portal(tenant: TenantContext): Promise<{ url: string }> {
    BillingService.admin(tenant);
    const state = await billing.state(this.prisma, tenant.organizationId, tenant.userId);
    if (!state?.stripeCustomerId) throw new UnprocessableEntityException({ code: 'NO_BILLING_ACCOUNT' });
    return this.deps.provider.createPortal(state.stripeCustomerId, new URL('/settings#billing', this.deps.appOrigin).toString());
  }

  // --- Stripe events --------------------------------------------------------------------------

  private planForPrice(plans: BillingPlanRow[], priceId: string | null): string | null {
    if (!priceId) return null;
    return plans.find((plan) => plan.stripePriceId === priceId)?.key ?? (priceId.startsWith('price_fixture_') ? priceId.slice('price_fixture_'.length) : null);
  }

  /** Verify and apply a webhook delivery. Throws BillingSignatureError for an unverified one. */
  async handleEvent(rawBody: string, signature: string): Promise<{ received: true }> {
    const event = this.deps.provider.verifyEvent(rawBody, signature);
    await this.apply(event);
    // Recorded after it applied: every handler is idempotent, so a retry after a failure is safe.
    await billing.beginEvent(this.prisma, event.id, event.type);
    return { received: true };
  }

  private async apply(event: BillingEvent): Promise<void> {
    const plans = await billing.plans(this.prisma);
    switch (event.type) {
      case 'checkout.completed': {
        if (!event.organizationId) return;
        if (event.customerId) await billing.linkCustomer(this.prisma, event.organizationId, event.customerId);
        if (event.mode === 'payment') {
          if (event.paid && event.planKey) await billing.grantPurchase(this.prisma, event.organizationId, event.planKey, event.id);
          return;
        }
        if (event.subscriptionId) await this.syncSubscription(event.subscriptionId, plans, event.organizationId, event.planKey);
        return;
      }
      case 'invoice.paid':
        if (event.subscriptionId) await this.syncSubscription(event.subscriptionId, plans, null, null);
        return;
      case 'invoice.failed':
        if (event.subscriptionId) {
          await billing.setSubscription(this.prisma, { organizationId: null, customerId: event.customerId, subscriptionId: event.subscriptionId, planKey: null, status: 'PAST_DUE', periodStart: null, periodEnd: null, newPeriod: false });
        }
        return;
      case 'subscription.changed': {
        const snapshot = event.subscription;
        await billing.setSubscription(this.prisma, {
          organizationId: snapshot.organizationId || null,
          customerId: snapshot.customerId || null,
          subscriptionId: snapshot.subscriptionId,
          planKey: this.planForPrice(plans, snapshot.priceId),
          status: snapshot.status,
          periodStart: snapshot.periodStart,
          periodEnd: snapshot.periodEnd,
          newPeriod: snapshot.status === 'ACTIVE',
        });
        return;
      }
      case 'ignored':
        return;
    }
  }

  /** Mirror a subscription from Stripe itself (the source of truth). */
  private async syncSubscription(subscriptionId: string, plans: BillingPlanRow[], organizationId: string | null, planKey: string | null): Promise<boolean> {
    const snapshot = await this.deps.provider.subscription(subscriptionId);
    if (!snapshot) return false;
    return billing.setSubscription(this.prisma, {
      organizationId: organizationId ?? snapshot.organizationId ?? null,
      customerId: snapshot.customerId || null,
      subscriptionId,
      planKey: this.planForPrice(plans, snapshot.priceId) ?? planKey,
      status: snapshot.status,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      newPeriod: snapshot.status === 'ACTIVE',
    });
  }

  // --- Promo codes ----------------------------------------------------------------------------

  private ipHash(ip: string): string {
    return keyedHash(this.deps.hashSecret, `promo-ip:${ip}`);
  }

  /** Public: is this code good right now, and what does it give? Rate-limited per address. */
  async checkPromo(code: string, ip: string): Promise<PromoCheckView> {
    const checked = await promoCodes.check(this.prisma, code, this.ipHash(ip));
    return { valid: checked.reason === 'OK', reason: checked.reason, summary: checked.reason === 'OK' ? promoSummary(checked) : null, skipsApproval: checked.reason === 'OK' && checked.skipsApproval };
  }

  /** Redeem for the caller's organization (org admins), after the same rate-limited check. */
  async redeemPromo(tenant: TenantContext, code: string, ip: string): Promise<BillingView> {
    BillingService.admin(tenant);
    const checked = await this.checkPromo(code, ip);
    if (!checked.valid) throw new UnprocessableEntityException({ code: `PROMO_${checked.reason}` });
    const result = await promoCodes.redeem(this.prisma, code, tenant.organizationId, tenant.userId);
    if (result !== 'REDEEMED') throw new UnprocessableEntityException({ code: `PROMO_${result}` });
    return this.view(tenant);
  }

  /** At sign-up (T-087): a code checked before the organization exists, redeemed right after. */
  async redeemForNewOrganization(code: string, organizationId: string): Promise<string> {
    return promoCodes.redeem(this.prisma, code, organizationId, null);
  }

  // --- Operators --------------------------------------------------------------------------------

  private async asOperator<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof OperatorRequiredError) throw new ForbiddenException();
      throw error;
    }
  }

  async adminAccounts(tenant: TenantContext): Promise<{ items: AdminBillingAccountView[] }> {
    return this.asOperator(async () => ({
      items: (await billing.adminAccounts(this.prisma, tenant.userId)).map((row) => ({ ...row, periodEnd: row.periodEnd?.toISOString() ?? null })),
    }));
  }

  async comp(tenant: TenantContext, organizationId: string, kind: PactCreditKind, packs: string[]): Promise<{ id: string }> {
    return this.asOperator(async () => ({ id: await billing.comp(this.prisma, tenant.userId, organizationId, kind, packs) }));
  }

  /** Re-mirror an organization's subscription from Stripe (operators; the nightly job does every one). */
  async resync(tenant: TenantContext, organizationId: string): Promise<{ resynced: boolean }> {
    return this.asOperator(async () => {
      const account = (await billing.adminAccounts(this.prisma, tenant.userId)).find((row) => row.organizationId === organizationId);
      if (!account) throw new NotFoundException();
      const resynced = account.subscriptionId ? await this.syncSubscription(account.subscriptionId, await billing.plans(this.prisma), organizationId, null) : false;
      return { resynced };
    });
  }

  private codeView(row: PromoCodeRow): PromoCodeView {
    return {
      ...row,
      planKeys: row.planKeys as BillingPlanKey[],
      validFrom: row.validFrom.toISOString(),
      validUntil: row.validUntil?.toISOString() ?? null,
      summary: promoSummary(row),
      stripeLinked: row.stripePromotionCodeId !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listPromoCodes(tenant: TenantContext): Promise<{ items: PromoCodeView[] }> {
    return this.asOperator(async () => ({ items: (await promoCodes.list(this.prisma, tenant.userId)).map((row) => this.codeView(row)) }));
  }

  /** Create a code; a discount is mirrored to Stripe as a coupon and promotion code. */
  async createPromoCode(tenant: TenantContext, input: CreatePromoCodeInput): Promise<{ items: PromoCodeView[] }> {
    return this.asOperator(async () => {
      const id = await promoCodes.create(this.prisma, tenant.userId, {
        ...input,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
      }).catch((error: unknown) => {
        if (error instanceof OperatorRequiredError) throw error;
        if (/promo_codes_code_key|unique/i.test(String((error as Error).message))) throw new UnprocessableEntityException({ code: 'PROMO_CODE_TAKEN' });
        throw error;
      });
      if (input.kind === 'DISCOUNT') {
        const mirrored = await this.deps.provider.createDiscount({
          code: input.code,
          name: input.description,
          percentOff: input.percentOff,
          amountOff: input.amountOff,
          currency: input.currency,
          duration: input.duration ?? 'ONCE',
          durationMonths: input.durationMonths,
          maxRedemptions: input.maxRedemptions,
          expiresAt: input.validUntil ? new Date(input.validUntil) : null,
        });
        await promoCodes.setStripe(this.prisma, tenant.userId, id, mirrored.promotionCodeId);
      }
      return this.listPromoCodes(tenant);
    });
  }

  async deactivatePromoCode(tenant: TenantContext, id: string): Promise<{ items: PromoCodeView[] }> {
    return this.asOperator(async () => {
      await promoCodes.deactivate(this.prisma, tenant.userId, id);
      return this.listPromoCodes(tenant);
    });
  }

  /** For the webhook controller: a bad signature is a 400, never a 500. */
  static isSignatureError(error: unknown): boolean {
    return error instanceof BillingSignatureError;
  }
}
