import { describe, expect, it } from 'vitest';
import { documentPages } from '../documents/document-text';
import { SIGN_ANCHORS, termSheetPdf } from './term-sheet';

const input = {
  dealName: 'Project Troubled',
  buyerName: 'Charlie Capital (synthetic)',
  sellerName: 'TroubledCo (synthetic)',
  version: 3,
  agreedAt: '2026-11-07T10:00:00.000Z',
  terms: [
    { lever: 'PURCHASE_PRICE', amount: '57200000.00', currency: 'USD', note: 'Equity purchase price, cash-free and debt-free.' },
    { lever: 'ESCROW', amount: '2000000.00', currency: 'USD', note: 'Held for 18 months.' },
  ],
  signatories: { buyer: 'Charlie Deal Lead', seller: 'Sam Seller' },
};

describe('term sheet (T-107)', () => {
  it('prints the parties, the headline price first, every term and both signature anchors', async () => {
    const { bytes, sha256 } = await termSheetPdf(input);
    const text = (await documentPages({ contentType: 'application/pdf', bytes, text: null })).map((page) => page.text).join('\n');
    for (const expected of ['Project Troubled', 'Charlie Capital (synthetic)', 'TroubledCo (synthetic)', 'Agreed version 3', 'Purchase price: USD 57,200,000.00', 'Escrow holdback: USD 2,000,000.00', 'Held for 18 months.', SIGN_ANCHORS.BUYER, SIGN_ANCHORS.SELLER, 'Sam Seller']) {
      expect(text).toContain(expected);
    }
    expect(text.indexOf('Purchase price')).toBeLessThan(text.indexOf('Escrow holdback'));
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same document for the same agreed version', async () => {
    expect((await termSheetPdf(input)).sha256).toBe((await termSheetPdf(input)).sha256);
  });

  it('never carries buyer-confidential pricing', async () => {
    const { bytes } = await termSheetPdf(input);
    const text = (await documentPages({ contentType: 'application/pdf', bytes, text: null })).map((page) => page.text).join('\n').toLowerCase();
    for (const leak of ['persona', 'compounder', 'grave', 'value investor', 'materiality', 'weight', 'finding']) expect(text).not.toContain(leak);
  });
});
