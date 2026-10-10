import { describe, expect, it } from 'vitest';
import { pactFromForm, problemUpTo } from './form';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const VALID = {
  name: 'Project Harbor',
  baseCurrency: 'USD',
  'buyer.name': 'Alpha Capital',
  'buyer.ownership': 'PRIVATE',
  'seller.name': 'Harbor Software',
  'seller.ownership': 'PUBLIC',
  'seller.ticker': 'hrbr',
  'seller.exchange': 'NASDAQ',
  'seller.companyType': 'SOFTWARE_SAAS',
  'askingPrice.known': 'no',
};

describe('pactFromForm', () => {
  it('builds the start-a-Pact command from the wizard fields', () => {
    expect(pactFromForm(form(VALID))).toEqual({
      ok: true,
      command: {
        name: 'Project Harbor',
        baseCurrency: 'USD',
        buyer: { name: 'Alpha Capital', ownership: 'PRIVATE', ticker: null, exchange: null, website: null, companyType: null },
        seller: {
          name: 'Harbor Software',
          ownership: 'PUBLIC',
          ticker: 'HRBR',
          exchange: 'NASDAQ',
          website: null,
          companyType: 'SOFTWARE_SAAS',
        },
        askingPrice: null,
      },
    });
  });

  it('drops a ticker typed for a company later marked private', () => {
    const result = pactFromForm(form({ ...VALID, 'seller.ownership': 'PRIVATE' }));
    expect(result.ok && result.command.seller).toMatchObject({ ticker: null, exchange: null });
  });

  it.each([
    [{ name: '' }, 'Give the Pact a name.'],
    [{ 'buyer.ownership': 'PUBLIC' }, 'A public buyer needs its ticker symbol.'],
    [{ 'seller.companyType': '' }, 'Choose what kind of company the seller is.'],
    [{ 'seller.website': 'harbor' }, 'The seller’s website must be a full http(s) address.'],
  ])('explains what is missing: %o', (override, message) => {
    expect(pactFromForm(form({ ...VALID, ...override }))).toMatchObject({ ok: false, message });
  });
});

describe('problemUpTo', () => {
  it('only blocks a step on fields the user has already reached', () => {
    const pactOnly = { name: 'Project Harbor', baseCurrency: 'USD' };
    expect(problemUpTo('pact', pactOnly)).toBeNull();
    expect(problemUpTo('buyer', pactOnly)).toBe('Name the buying entity.');
    expect(problemUpTo('seller', { ...VALID, 'seller.ticker': '' })).toBe('A public seller needs its ticker symbol.');
    expect(problemUpTo('review', VALID)).toBeNull();
  });
});

describe('asking price in the wizard', () => {
  const PRICED = {
    ...VALID,
    'askingPrice.known': 'yes',
    'askingPrice.amount': '25,000,000',
    'askingPrice.currency': 'USD',
    'askingPrice.basis': 'ENTERPRISE_VALUE',
    'askingPrice.source': 'BANKER',
    'askingPrice.quotedOn': '2026-10-01',
    'askingPrice.earnOutAmount': '',
    'askingPrice.note': '',
  };

  it('adds the asking price to the command, or leaves it out when not known yet', () => {
    const priced = pactFromForm(form(PRICED));
    expect(priced.ok && priced.command.askingPrice).toEqual({
      amount: '25000000',
      currency: 'USD',
      basis: 'ENTERPRISE_VALUE',
      source: 'BANKER',
      quotedOn: '2026-10-01',
      earnOutAmount: null,
      note: null,
    });
    const unknown = pactFromForm(form(VALID));
    expect(unknown.ok && unknown.command.askingPrice).toBeNull();
  });

  it('blocks the asking step until a price is entered or marked unknown', () => {
    expect(problemUpTo('asking', { ...PRICED, 'askingPrice.amount': '' })).toBe('Enter the asking price, or choose “Not known yet”.');
    expect(problemUpTo('asking', { ...PRICED, 'askingPrice.amount': 'lots' })).toBe('Enter the asking price as a number, e.g. 25,000,000.');
    expect(problemUpTo('seller', { ...PRICED, 'askingPrice.amount': '' })).toBeNull();
  });
});
