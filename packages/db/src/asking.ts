import type { TransactionClient } from './client';

export type AskingBasisValue = 'ENTERPRISE_VALUE' | 'EQUITY_VALUE';
export type AskingSourceValue = 'TEASER' | 'MANAGEMENT' | 'LETTER_OF_INTENT' | 'BANKER' | 'OTHER';

export interface AskingPriceRecord {
  id: string;
  version: number;
  /** Decimal string; never a JavaScript number. */
  amount: string;
  currency: string;
  basis: AskingBasisValue;
  source: AskingSourceValue;
  /** `YYYY-MM-DD`, or null when the date is not known. */
  quotedOn: string | null;
  earnOutAmount: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: Date;
}

export interface AskingPriceInput {
  amount: string;
  currency: string;
  basis: AskingBasisValue;
  source: AskingSourceValue;
  quotedOn: string | null;
  earnOutAmount: string | null;
  note: string | null;
}

const select = {
  id: true,
  dealId: true,
  version: true,
  amount: true,
  currency: true,
  basis: true,
  source: true,
  quotedOn: true,
  earnOutAmount: true,
  note: true,
  recordedBy: true,
  recordedAt: true,
} as const;

type Row = {
  id: string;
  dealId: string;
  version: number;
  amount: { toFixed(): string };
  currency: string;
  basis: AskingBasisValue;
  source: AskingSourceValue;
  quotedOn: Date | null;
  earnOutAmount: { toFixed(): string } | null;
  note: string | null;
  recordedBy: string;
  recordedAt: Date;
};

function toRecord({ dealId: _deal, ...row }: Row): AskingPriceRecord {
  return {
    ...row,
    amount: row.amount.toFixed(),
    earnOutAmount: row.earnOutAmount?.toFixed() ?? null,
    quotedOn: row.quotedOn ? row.quotedOn.toISOString().slice(0, 10) : null,
  };
}

const same = (record: AskingPriceRecord, input: AskingPriceInput) =>
  record.basis === input.basis &&
  record.source === input.source &&
  record.currency === input.currency &&
  record.quotedOn === input.quotedOn &&
  record.note === input.note &&
  normalize(record.amount) === normalize(input.amount) &&
  normalize(record.earnOutAmount) === normalize(input.earnOutAmount);

/** "1500000.0000" and "1500000" are the same price. */
function normalize(value: string | null): string | null {
  if (value === null) return null;
  const [integer = '0', fraction = ''] = value.split('.');
  const frac = fraction.replace(/0+$/, '');
  return `${integer.replace(/^0+(?=\d)/, '')}${frac ? `.${frac}` : ''}`;
}

/** Asking prices, newest version first. RLS keeps them on the buyer side. */
export const askingPrices = {
  async history(tx: TransactionClient, dealId: string): Promise<AskingPriceRecord[]> {
    const rows = await tx.askingPrice.findMany({ where: { dealId }, select, orderBy: { version: 'desc' } });
    return (rows as unknown as Row[]).map(toRecord);
  },

  /** The current (highest-version) asking price per deal. */
  async currentFor(tx: TransactionClient, dealIds: readonly string[]): Promise<Map<string, AskingPriceRecord>> {
    const current = new Map<string, AskingPriceRecord>();
    if (dealIds.length === 0) return current;
    const rows = (await tx.askingPrice.findMany({
      where: { dealId: { in: [...dealIds] } },
      select,
      orderBy: [{ dealId: 'asc' }, { version: 'desc' }],
    })) as unknown as Row[];
    for (const row of rows) if (!current.has(row.dealId)) current.set(row.dealId, toRecord(row));
    return current;
  },

  /**
   * Record the next version. Recording the same price again changes nothing
   * and returns the current version (`created: false`).
   */
  async record(
    tx: TransactionClient,
    input: AskingPriceInput & { organizationId: string; dealId: string; recordedBy: string },
  ): Promise<{ record: AskingPriceRecord; created: boolean }> {
    const [latest] = await askingPrices.history(tx, input.dealId);
    if (latest && same(latest, input)) return { record: latest, created: false };
    const row = await tx.askingPrice.create({
      data: {
        organizationId: input.organizationId,
        dealId: input.dealId,
        version: (latest?.version ?? 0) + 1,
        amount: input.amount,
        currency: input.currency,
        basis: input.basis,
        source: input.source,
        quotedOn: input.quotedOn ? new Date(`${input.quotedOn}T00:00:00Z`) : null,
        earnOutAmount: input.earnOutAmount,
        note: input.note,
        recordedBy: input.recordedBy,
      },
      select,
    });
    return { record: toRecord(row as unknown as Row), created: true };
  },
};
