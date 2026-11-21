'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../(app)/deals/_lib/api';

/** AI models in the operator console (T-131). The API checks every action again and audits it. */
const uuid = z.uuid();
/** The three roles, and the job types of best-of-breed routing (T-132). */
const ALIASES = ['fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision'] as const;
const ROLE_ALIASES = ['fast', 'balanced', 'deep_review'];
const back = (outcome: string, organizationId?: string): never =>
  redirect(`/admin?tab=models&outcome=${outcome}${organizationId ? `&aiorg=${organizationId}` : ''}`);
const code = (result: { kind: string; data?: unknown }) => {
  const value = (result.data as { code?: unknown } | undefined)?.code;
  return typeof value === 'string' ? `ai-${value.toLowerCase().replaceAll('_', '-')}` : result.kind;
};

export async function addModel(formData: FormData): Promise<void> {
  const body = { provider: formData.get('provider'), providerModelId: String(formData.get('providerModelId') ?? '').trim(), label: String(formData.get('label') ?? '').trim() };
  const result = await apiPost('/v1/admin/ai-models', body);
  revalidatePath('/admin');
  back(result.kind === 'ok' ? 'ok-ai-added' : code(result));
}

/** Add from Bedrock: use this model (it joins the catalog and its health check starts). */
export async function useBedrockModel(modelId: string): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/.test(modelId)) return back('invalid');
  const result = await apiPost('/v1/admin/ai-models/bedrock', { modelId });
  revalidatePath('/admin');
  back(result.kind === 'ok' ? 'ok-ai-evaluating' : code(result));
}

export async function evaluateModel(modelId: string): Promise<void> {
  if (!uuid.safeParse(modelId).success) return back('invalid');
  const result = await apiPost(`/v1/admin/ai-models/${modelId}/evaluation`, {});
  back(result.kind === 'ok' ? 'ok-ai-evaluating' : code(result));
}

export async function retireModel(modelId: string): Promise<void> {
  if (!uuid.safeParse(modelId).success) return back('invalid');
  const result = await apiPost(`/v1/admin/ai-models/${modelId}/retire`, {});
  back(result.kind === 'ok' ? 'ok-ai-retired' : code(result));
}

export async function setPlatformRoute(alias: string, formData: FormData): Promise<void> {
  const modelId = String(formData.get('modelId') ?? '');
  if (!ALIASES.includes(alias as (typeof ALIASES)[number])) return back('invalid');
  // A job type set back to its registry chain (T-132); the three roles always keep a model.
  if (modelId === '' && !ROLE_ALIASES.includes(alias)) {
    const cleared = await apiSend('DELETE', `/v1/admin/ai-models/routes/${alias}`, {});
    return back(cleared.kind === 'ok' ? 'ok-ai-route' : code(cleared));
  }
  if (!uuid.safeParse(modelId).success) return back('invalid');
  const result = await apiSend('PUT', `/v1/admin/ai-models/routes/${alias}`, { modelId });
  back(result.kind === 'ok' ? 'ok-ai-route' : code(result));
}

/** An organization's allowed models (none ticked: the platform defaults) and its model per role (blank: the default). */
export async function setOrganizationModels(organizationId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(organizationId).success) return back('invalid');
  const allowed = formData.getAll('allowed').map(String).filter((value) => uuid.safeParse(value).success);
  const routes = Object.fromEntries(ALIASES.flatMap((alias) => {
    const value = String(formData.get(`route-${alias}`) ?? '');
    return uuid.safeParse(value).success ? [[alias, value]] : [];
  }));
  const result = await apiSend('PUT', `/v1/admin/ai-models/organizations/${organizationId}`, { allowed, routes });
  back(result.kind === 'ok' ? 'ok-ai-org' : code(result), organizationId);
}

/** A provider outside AWS (ADR 0034): its data terms. Both ticked lets its models be evaluated and serve. */
export async function setProviderTerms(provider: 'anthropic' | 'openai' | 'google', formData: FormData): Promise<void> {
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'google') return back('invalid');
  const text = (name: string) => {
    const value = String(formData.get(name) ?? '').trim();
    return value === '' ? null : value.slice(0, name === 'notes' ? 1000 : 80);
  };
  const result = await apiSend('PUT', `/v1/admin/ai-models/providers/${provider}/terms`, {
    dpaInPlace: formData.get('dpaInPlace') === 'on',
    zeroRetention: formData.get('zeroRetention') === 'on',
    region: text('region'),
    notes: text('notes'),
  });
  back(result.kind === 'ok' ? 'ok-ai-terms' : code(result));
}
