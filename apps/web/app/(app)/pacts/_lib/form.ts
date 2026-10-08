import { startPactSchema, type StartPactCommand } from '@pactlab/contracts';

export type PactFormResult = { ok: true; command: StartPactCommand } | { ok: false; field: string; message: string };

const PARTY_FIELDS = ['name', 'ownership', 'ticker', 'exchange', 'website', 'companyType'] as const;

const MESSAGES: Readonly<Record<string, string>> = {
  name: 'Give the Pact a name.',
  baseCurrency: 'Choose a currency.',
  'buyer.name': 'Name the buying entity.',
  'buyer.ownership': 'Say whether the buyer is public or private.',
  'buyer.ticker': 'A public buyer needs its ticker symbol.',
  'buyer.website': 'The buyer’s website must be a full http(s) address.',
  'seller.name': 'Name the selling entity.',
  'seller.ownership': 'Say whether the seller is public or private.',
  'seller.ticker': 'A public seller needs its ticker symbol.',
  'seller.website': 'The seller’s website must be a full http(s) address.',
  'seller.companyType': 'Choose what kind of company the seller is.',
};

function party(form: FormData, prefix: 'buyer' | 'seller') {
  const entries = PARTY_FIELDS.map((field) => [field, form.get(`${prefix}.${field}`)] as const).filter(
    ([, value]) => typeof value === 'string' && value !== '',
  );
  return Object.fromEntries(entries);
}

/** Read the wizard's form into the shared contract; the API validates again. */
export function pactFromForm(form: FormData): PactFormResult {
  const parsed = startPactSchema.safeParse({
    name: form.get('name'),
    baseCurrency: form.get('baseCurrency') || undefined,
    buyer: party(form, 'buyer'),
    seller: party(form, 'seller'),
  });
  if (parsed.success) return { ok: true, command: parsed.data };
  const path = parsed.error.issues[0]?.path.join('.') ?? '';
  return { ok: false, field: path, message: MESSAGES[path] ?? 'Check the details and try again.' };
}

/** Wizard steps in order; each owns the fields with its prefix. */
export const WIZARD_STEPS = ['pact', 'buyer', 'seller', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function stepOfField(field: string): WizardStep {
  if (field.startsWith('buyer')) return 'buyer';
  if (field.startsWith('seller')) return 'seller';
  return 'pact';
}

/** The first problem at or before this step, so Next only blocks on what the user has seen. */
export function problemUpTo(step: WizardStep, values: Readonly<Record<string, string>>): string | null {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  const result = pactFromForm(data);
  if (result.ok) return null;
  return WIZARD_STEPS.indexOf(stepOfField(result.field)) <= WIZARD_STEPS.indexOf(step) ? result.message : null;
}
