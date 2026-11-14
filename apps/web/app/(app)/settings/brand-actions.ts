'use server';

import type { BrandKitView } from '@pactlab/contracts';
import { BRAND_FONTS } from '@pactlab/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../deals/_lib/api';

/** Settings → Brand (T-123). Every change is checked again by the API (owners and admins only). */
const done = (outcome?: string) => {
  revalidatePath('/', 'layout');
  redirect(`/settings${outcome ? `?brand=${outcome}` : ''}#brand`);
};

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((value) => value.toLowerCase());

export async function saveBrandWebsite(formData: FormData): Promise<void> {
  const raw = String(formData.get('websiteUrl') ?? '').trim();
  const withScheme = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
  const url = z.url({ protocol: /^https$/ }).max(500).safeParse(withScheme);
  if (raw && !url.success) done('website-invalid');
  const result = await apiSend<BrandKitView>('PUT', '/v1/organization/brand/website', { websiteUrl: raw ? url.data : null });
  done(result.kind === 'ok' ? (raw ? 'fetching' : undefined) : 'error');
}

export async function fetchBrandAgain(): Promise<void> {
  const result = await apiSend<BrandKitView>('POST', '/v1/organization/brand/extract', {});
  done(result.kind === 'ok' ? 'fetching' : 'error');
}

export async function applyBrandDraft(): Promise<void> {
  const result = await apiSend<BrandKitView>('POST', '/v1/organization/brand/apply-draft', {});
  done(result.kind === 'ok' ? 'applied' : 'error');
}

export async function saveBrandKit(formData: FormData): Promise<void> {
  const accent = hex.safeParse(formData.get('accentColor'));
  const primary = hex.safeParse(formData.get('primaryColor'));
  const font = z.enum(BRAND_FONTS).safeParse(formData.get('font'));
  const result = await apiSend<BrandKitView>('PUT', '/v1/organization/brand', {
    accentColor: formData.get('useAccent') === 'on' && accent.success ? accent.data : null,
    primaryColor: formData.get('usePrimary') === 'on' && primary.success ? primary.data : null,
    font: font.success ? font.data : 'MANROPE',
  });
  done(result.kind === 'ok' ? 'saved' : 'error');
}

const LOGO_MAX = 512 * 1024;

export async function uploadBrandLogo(formData: FormData): Promise<void> {
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) done('logo-missing');
  const logo = file as File;
  if (logo.size > LOGO_MAX) done('logo-too-large');
  const result = await apiSend<BrandKitView>('POST', '/v1/organization/brand/logo', { contentBase64: Buffer.from(await logo.arrayBuffer()).toString('base64') });
  done(result.kind === 'ok' ? 'saved' : result.kind === 'invalid' && result.code === 'BRAND_LOGO_TOO_LARGE' ? 'logo-too-large' : result.kind === 'invalid' ? 'logo-type' : 'error');
}

export async function revertBrand(): Promise<void> {
  const result = await apiSend<BrandKitView>('DELETE', '/v1/organization/brand', {});
  done(result.kind === 'ok' ? 'reverted' : 'error');
}
