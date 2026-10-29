'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/regulatory?outcome=${encodeURIComponent(outcome)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const optional = (form: FormData, name: string) => text(form, name) || null;
const topics = (value: string) => value.split(',').map((topic) => topic.trim().toUpperCase().replaceAll(/[^A-Z_]/g, '_')).filter((topic) => /^[A-Z][A-Z_]{1,40}$/.test(topic));

/** Add a cited regulatory entry (terms, buyer, feedback, revision or pledge). The API checks the quote is on the page. */
export async function addEntry(dealId: string, kind: 'TERMS' | 'BUYER' | 'FEEDBACK' | 'REVISION' | 'COMMITMENT' | 'POSTURE', form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const citation = { documentId: text(form, 'documentId'), pageNumber: Number(text(form, 'pageNumber') || '1'), quote: text(form, 'quote') };
  const payloads = {
    TERMS: () => ({
      signedOn: text(form, 'signedOn'),
      outsideDate: text(form, 'outsideDate'),
      effortsStandard: text(form, 'effortsStandard'),
      divestitureCap: Number(text(form, 'divestitureCap') || '0'),
      currency: text(form, 'currency') || 'USD',
      terminationFees: text(form, 'fee') ? [{ payer: text(form, 'feePayer') || 'ACQUIRER', amount: text(form, 'fee').replaceAll(',', ''), trigger: text(form, 'feeTrigger') || 'Clearance not obtained by the outside date' }] : [],
      ebitdaMultiple: optional(form, 'ebitdaMultiple'),
    }),
    BUYER: () => ({
      name: text(form, 'name'),
      retailSitesOperated: Number(text(form, 'retailSitesOperated') || '0'),
      yearsOperatingRetail: Number(text(form, 'yearsOperatingRetail') || '0'),
      precedents: text(form, 'precedentNote') ? [{ year: Number(text(form, 'precedentYear') || '2000'), note: text(form, 'precedentNote'), source: text(form, 'precedentSource') || 'Cited document' }] : [],
    }),
    FEEDBACK: () => ({
      round: Number(text(form, 'round') || '1'),
      date: text(form, 'date'),
      regulator: text(form, 'regulator'),
      criticisms: topics(text(form, 'topic')).map((topic) => ({ topic, substance: text(form, 'substance') })),
    }),
    REVISION: () => ({ revision: Number(text(form, 'revision') || '1'), date: text(form, 'date'), addresses: topics(text(form, 'addresses')) }),
    COMMITMENT: () => ({
      text: text(form, 'text'),
      measurement: optional(form, 'measurement'),
      enforcementParty: optional(form, 'enforcementParty'),
      durationMonths: text(form, 'durationMonths') ? Number(text(form, 'durationMonths')) : null,
    }),
    POSTURE: () => ({
      date: text(form, 'date'),
      authority: text(form, 'authority'),
      scope: text(form, 'scope').toUpperCase(),
      direction: text(form, 'direction').toUpperCase(),
      signal: text(form, 'signal'),
    }),
  };
  const result = await apiPost(`/v1/deals/${dealId}/regulatory/entries`, { kind, payload: payloads[kind](), citation });
  back(dealId, result.kind === 'ok' ? 'ok-entry' : result.kind === 'invalid' ? (result.code === 'CITATION_NOT_ON_PAGE' ? 'citation' : 'entry-invalid') : result.kind);
}

/** Record the current results as DRAFT findings in the register (reviewed and priced on Findings). */
export async function proposeFindings(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost<{ created: number; existing: number }>(`/v1/deals/${dealId}/regulatory/findings`, {});
  back(dealId, result.kind === 'ok' ? `ok-proposed-${result.data.created}-${result.data.existing}` : result.kind === 'not-found' ? 'nothing' : result.kind);
}

const list = (value: string) => [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];

/** Save a candidate remedy package; the API resolves the recipe into an explicit site list. */
export async function addScenario(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const base = text(form, 'baseRevision');
  const result = await apiPost(`/v1/deals/${dealId}/regulatory/scenarios`, {
    name: text(form, 'name'),
    baseRevision: base ? Number(base) : null,
    remedyBuyer: optional(form, 'remedyBuyer'),
    addMarkets: text(form, 'addMarkets').split(/\n|;/).map((market) => market.trim()).filter(Boolean),
    addResidualMarkets: form.get('addResidualMarkets') === 'on',
    divestingParty: text(form, 'divestingParty') === 'ACQUIRER' ? 'ACQUIRER' : 'TARGET',
    addSites: list(text(form, 'addSites')),
    removeSites: list(text(form, 'removeSites')),
    transferOperations: form.get('transferOperations') === 'on',
  });
  const code = result.kind === 'invalid' ? result.code : undefined;
  back(dealId, result.kind === 'ok' ? 'ok-scenario' : code === 'UNKNOWN_MARKETS' || code === 'UNKNOWN_SITES' || code === 'UNKNOWN_REVISION' || code === 'EMPTY_PACKAGE' ? `scenario-${code.toLowerCase().replaceAll('_', '-')}` : result.kind === 'invalid' ? 'scenario-invalid' : result.kind);
}
