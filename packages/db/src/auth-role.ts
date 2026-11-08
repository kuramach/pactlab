import type { PrismaClient, TransactionClient } from './client';
import { APP_DB_ROLE } from './tenant';

/**
 * Sign-in and OAuth state live behind SECURITY DEFINER functions; the
 * runtime role has no table privileges on it. These wrappers call them as
 * `pactlab_app` with no tenant context (pre-authentication).
 */
export async function asApp<T>(prisma: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Constant statement: no user input reaches SET ROLE.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
    return fn(tx);
  });
}

