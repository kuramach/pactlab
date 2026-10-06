import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const CLIENT_IP_HEADER = 'x-pactlab-client-ip';
const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Rate-limit key for code requests. The web server calls the API on the
 * user's behalf, so it forwards the client address it saw; otherwise the
 * socket address is used. Used only to throttle, never to authorize — the
 * per-address limits and the 5-attempt lock do not depend on it.
 */
export function rateLimitAddress(request: FastifyRequest): string {
  const forwarded = request.headers[CLIENT_IP_HEADER];
  return typeof forwarded === 'string' && IP_LIKE.test(forwarded) ? forwarded : request.ip;
}

/** Keyed hash for codes and client addresses; only hashes are stored. */
export function keyedHash(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
