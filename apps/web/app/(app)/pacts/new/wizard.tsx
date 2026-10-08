'use client';

import {
  COMPANY_TYPE_LABELS,
  COMPANY_TYPES,
  deriveTransactionType,
  sourcesFor,
  TRANSACTION_TYPE_EXPLANATIONS,
  type CompanyType,
} from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { useActionState, useState } from 'react';
import { problemUpTo, WIZARD_STEPS, type WizardStep } from '../_lib/form';
import { startPact, type StartPactState } from './actions';

const STEP_TITLES: Readonly<Record<WizardStep, string>> = {
  pact: 'Name the Pact',
  buyer: 'Buying entity',
  seller: 'Selling entity',
  review: 'Review and start',
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'CHF', 'SGD'] as const;

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const DEAL_TYPE_LABELS = {
  PUBLIC_ACQUIRER: 'Public acquirer',
  PRIVATE_ACQUIRER: 'Private acquisition',
  TAKE_PRIVATE: 'Take-private',
} as const;

type Values = Record<string, string>;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function PartyFields({
  role,
  values,
  set,
}: {
  role: 'buyer' | 'seller';
  values: Values;
  set: (key: string, value: string) => void;
}) {
  const key = (field: string) => `${role}.${field}`;
  const ownership = values[key('ownership')] ?? '';
  return (
    <div className="flex flex-col gap-4">
      <Field label="Legal or trading name">
        <input
          className={inputClass}
          value={values[key('name')] ?? ''}
          onChange={(event) => set(key('name'), event.target.value)}
          maxLength={200}
          autoFocus
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Is it public or private?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['PRIVATE', 'PUBLIC'] as const).map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm ${
                ownership === option ? 'border-indigo-ink bg-muted' : 'border-border'
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name={`${role}-ownership`}
                  checked={ownership === option}
                  onChange={() => set(key('ownership'), option)}
                />
                {option === 'PUBLIC' ? 'Public' : 'Private'}
              </span>
              <span className="text-muted-foreground">
                {option === 'PUBLIC' ? 'Listed on a stock exchange.' : 'Privately held, including PE- or VC-backed.'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {ownership === 'PUBLIC' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ticker symbol">
            <input
              className={`${inputClass} uppercase`}
              value={values[key('ticker')] ?? ''}
              onChange={(event) => set(key('ticker'), event.target.value)}
              maxLength={12}
            />
          </Field>
          <Field label="Exchange" hint="Optional, e.g. NASDAQ, NYSE, LSE.">
            <input
              className={inputClass}
              value={values[key('exchange')] ?? ''}
              onChange={(event) => set(key('exchange'), event.target.value)}
              maxLength={40}
            />
          </Field>
        </div>
      ) : null}
      <Field label="Website" hint="Optional.">
        <input
          className={inputClass}
          type="url"
          placeholder="https://"
          value={values[key('website')] ?? ''}
          onChange={(event) => set(key('website'), event.target.value)}
        />
      </Field>
      {role === 'seller' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What kind of company is it?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {COMPANY_TYPES.map((type) => {
              const plan = sourcesFor(type);
              const selected = values[key('companyType')] === type;
              return (
                <label
                  key={type}
                  className={`flex cursor-pointer items-start justify-between gap-2 rounded-lg border p-3 text-sm ${
                    selected ? 'border-indigo-ink bg-muted' : 'border-border'
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="seller-company-type"
                      checked={selected}
                      onChange={() => set(key('companyType'), type)}
                    />
                    {COMPANY_TYPE_LABELS[type]}
                  </span>
                  {type === 'OTHER' ? null : plan.packAvailable ? (
                    <Badge variant="calculation">Full pack</Badge>
                  ) : (
                    <Badge>Pack planned</Badge>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

function Review({ values }: { values: Values }) {
  const buyer = { name: values['buyer.name'] ?? '', ownership: values['buyer.ownership'] === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE' } as const;
  const seller = { name: values['seller.name'] ?? '', ownership: values['seller.ownership'] === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE' } as const;
  const dealType = deriveTransactionType(buyer, seller);
  const plan = sourcesFor((values['seller.companyType'] ?? 'OTHER') as CompanyType);
  const describe = (party: typeof buyer, prefix: string) => {
    const ticker = values[`${prefix}.ticker`]?.trim().toUpperCase();
    return `${party.name} · ${party.ownership === 'PUBLIC' ? `public${ticker ? ` (${ticker})` : ''}` : 'private'}`;
  };
  return (
    <div className="flex flex-col gap-5 text-sm">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Buyer</dt>
          <dd className="font-medium">{describe(buyer, 'buyer')}</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Seller</dt>
          <dd className="font-medium">{describe(seller, 'seller')}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1 rounded-lg bg-muted p-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Deal type</span>
        <span className="text-base font-semibold">{DEAL_TYPE_LABELS[dealType]}</span>
        <span className="text-muted-foreground">{TRANSACTION_TYPE_EXPLANATIONS[dealType]}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium">Sources Pactlab will ask for</span>
        {plan.note ? <p className="text-muted-foreground">{plan.note}</p> : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {plan.sources.map((source) => (
            <li key={source.kind} className="flex flex-col gap-1 rounded-lg border border-border p-3">
              <span className="font-medium">
                {source.label} · {source.providerLabel}
              </span>
              <span className="text-muted-foreground">{source.why}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Each source connects through its API or by uploading an export. You choose on the next screen.
        </p>
      </div>
    </div>
  );
}

/** Four steps, one form. The server action re-validates and the API decides. */
export function PactWizard() {
  const [values, setValues] = useState<Values>({ baseCurrency: 'USD' });
  const [step, setStep] = useState<WizardStep>('pact');
  const [problem, setProblem] = useState<string | null>(null);
  const [state, action, pending] = useActionState<StartPactState, FormData>(startPact, { error: null });
  const index = WIZARD_STEPS.indexOf(step);
  const set = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setProblem(null);
  };
  const next = () => {
    const found = problemUpTo(step, values);
    setProblem(found);
    if (!found) setStep(WIZARD_STEPS[index + 1] ?? step);
  };
  const error = problem ?? state.error;

  return (
    <Card>
      <CardHeader>
        <ol className="flex flex-wrap gap-2 text-xs" aria-label="Steps">
          {WIZARD_STEPS.map((entry, position) => (
            <li
              key={entry}
              aria-current={entry === step ? 'step' : undefined}
              className={`rounded-full border px-3 py-1 ${
                entry === step ? 'border-indigo-ink font-semibold' : 'border-border text-muted-foreground'
              }`}
            >
              {position + 1}. {STEP_TITLES[entry]}
            </li>
          ))}
        </ol>
        <CardTitle className="pt-2">{STEP_TITLES[step]}</CardTitle>
        <CardDescription>
          {step === 'pact'
            ? 'A working name your team will recognise — most teams use a code name.'
            : step === 'buyer'
              ? 'Who is acquiring? Usually your organization or a fund or portfolio company it manages.'
              : step === 'seller'
                ? 'Who is being acquired? Its type decides which sources Pactlab switches on.'
                : 'Check the details. The deal type is fixed when the Pact starts.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error ? (
          <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        {step === 'pact' ? (
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Pact name">
              <input
                className={inputClass}
                value={values['name'] ?? ''}
                onChange={(event) => set('name', event.target.value)}
                placeholder="Project Harbor"
                maxLength={200}
                autoFocus
              />
            </Field>
            <Field label="Base currency">
              <select
                className={inputClass}
                value={values['baseCurrency']}
                onChange={(event) => set('baseCurrency', event.target.value)}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
        {step === 'buyer' ? <PartyFields key="buyer" role="buyer" values={values} set={set} /> : null}
        {step === 'seller' ? <PartyFields key="seller" role="seller" values={values} set={set} /> : null}
        {step === 'review' ? <Review values={values} /> : null}

        <form action={action} className="flex items-center justify-between gap-3 border-t border-border pt-4">
          {Object.entries(values).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <Button
            variant="ghost"
            disabled={index === 0 || pending}
            onClick={() => {
              setProblem(null);
              setStep(WIZARD_STEPS[index - 1] ?? step);
            }}
          >
            Back
          </Button>
          {step === 'review' ? (
            <Button type="submit" disabled={pending}>
              {pending ? 'Starting…' : 'Start Pact'}
            </Button>
          ) : (
            <Button onClick={next}>Next</Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
