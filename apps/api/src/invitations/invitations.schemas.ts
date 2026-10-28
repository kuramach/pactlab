import { z } from 'zod';

export const INVITATION_SIDES = ['BUYER', 'SELLER', 'ADVISOR', 'BIDDER'] as const;

/** Roles each side may be invited with (mirrors the deal_invitations CHECK). */
export const ROLES_BY_SIDE = {
  BUYER: ['ANALYST', 'REVIEWER', 'VIEWER'],
  SELLER: ['TARGET_CONTRIBUTOR'],
  ADVISOR: ['ADVISER', 'VIEWER'],
  // A bidding firm's person in a seller-led pact (T-097); always tied to their bid.
  BIDDER: ['BIDDER'],
} as const;

export const createInvitationSchema = z
  .strictObject({
    email: z.email().max(320).transform((value) => value.trim().toLowerCase()),
    side: z.enum(INVITATION_SIDES),
    role: z.enum(['ANALYST', 'REVIEWER', 'VIEWER', 'TARGET_CONTRIBUTOR', 'ADVISER', 'BIDDER']),
    /** Set only by the sale process when inviting a bidder (never from the general invite form). */
    bidId: z.uuid().optional(),
  })
  .refine((value) => (ROLES_BY_SIDE[value.side] as readonly string[]).includes(value.role), { path: ['role'], message: 'That role is not available for this side' })
  .refine((value) => (value.side === 'BIDDER') === (value.bidId !== undefined), { path: ['bidId'], message: 'Bidders are invited from the bidders board' });
export type CreateInvitationBody = z.infer<typeof createInvitationSchema>;

export const invitationParamsSchema = z.strictObject({ dealId: z.uuid(), invitationId: z.uuid() });
/** Tokens are 43 URL-safe characters (32 random bytes). */
export const invitationTokenSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export interface InvitationView {
  id: string;
  email: string;
  side: (typeof INVITATION_SIDES)[number];
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreview {
  dealName: string;
  organizationName: string;
  email: string;
  side: string;
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
}

/** The general invite form: every side but bidders, who are invited from the bidders board with their bid (T-097). */
export const publicCreateInvitationSchema = createInvitationSchema.refine((value) => value.side !== 'BIDDER', { path: ['side'], message: 'Invite bidders from the bidders board' });
