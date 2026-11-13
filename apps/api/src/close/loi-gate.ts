import type { TransactionClient } from '@pactlab/db';

/** The close gate (T-119): when the pact requires it, a countersigned letter of intent before the definitive terms are signed. */
export async function loiSatisfied(tx: TransactionClient, dealId: string): Promise<boolean> {
  const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { loiRequired: true } });
  if (!deal?.loiRequired) return true;
  return (await tx.loiVersion.count({ where: { dealId, status: 'COUNTERSIGNED' } })) > 0;
}
