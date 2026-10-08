import type { TransactionType } from '../transaction-type';
import type { Ownership } from './types';

/**
 * The deal type follows from who is buying whom: a public buyer is a public
 * acquirer whatever it buys; a private buyer of a public company takes it
 * private; otherwise it is a private acquisition.
 */
export function deriveTransactionType(
  buyer: { readonly ownership: Ownership },
  seller: { readonly ownership: Ownership },
): TransactionType {
  if (buyer.ownership === 'PUBLIC') return 'PUBLIC_ACQUIRER';
  return seller.ownership === 'PUBLIC' ? 'TAKE_PRIVATE' : 'PRIVATE_ACQUIRER';
}

export const TRANSACTION_TYPE_EXPLANATIONS: Readonly<Record<TransactionType, string>> = {
  PUBLIC_ACQUIRER:
    'A public buyer: accretion/dilution and disclosure matter, and the price must stand up to shareholders.',
  PRIVATE_ACQUIRER:
    'A private buyer acquiring a private company: diligence relies on what the seller shares, so evidence coverage matters most.',
  TAKE_PRIVATE:
    'A private buyer taking a public company private: public filings anchor the numbers and the offer premium needs support.',
};
