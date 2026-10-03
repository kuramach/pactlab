export const TRANSACTION_TYPES = ['PUBLIC_ACQUIRER', 'PRIVATE_ACQUIRER', 'TAKE_PRIVATE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
