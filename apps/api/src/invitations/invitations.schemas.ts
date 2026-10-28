import { z } from 'zod';

export const INVITATION_SIDES = ['BUYER', 'SELLER', 'ADVISOR'] as const;

/** Roles each side may be invited with (mirrors the deal_invitations CHECK). */
export const ROLES_BY_SIDE = {
  BUYER: ['ANALYST', 'REVIEWER', 'VIEWER'],
  SELLER: ['TARGET_CONTRIBUTOR'],
  ADVISOR: ['ADVISER', 'VIEWER'],
} as const;

export const createInvitationSchema = z
  .strictObject({
    email: z.email().max(320).transform((value) => value.trim().toLowerCase()),
    side: z.enum(INVITATION_SIDES),
    role: z.enum(['ANALYST', 'REVIEWER', 'VIEWER', 'TARGET_CONTRIBUTOR', 'ADVISER']),
  })
  .refine((value) => (ROLES_BY_SIDE[value.side] as readonly string[]).includes(value.role), { path: ['role'], message: 'That role is not available for this side' });
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
