import type { BrandKitView } from '@pactlab/contracts';
import { Button, buttonVariants } from '@pactlab/ui';
import { Palette } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { apiGet } from '../deals/_lib/api';
import { BRAND_PROMPT_COOKIE } from '../../../lib/brand';
import { getI18n } from '../../../lib/i18n/server';
import { skipBrandPrompt } from './brand-prompt-actions';

/**
 * The setup ask (T-123): an owner or admin of an organization still on the Pactlab look is asked
 * once for the company website, to brand Pactlab. Skippable; Settings → Brand has it later.
 */
export async function BrandPrompt() {
  if ((await cookies()).get(BRAND_PROMPT_COOKIE)?.value === 'skip') return null;
  const result = await apiGet<BrandKitView>('/v1/organization/brand');
  if (result.kind !== 'ok' || !result.data.canEdit || result.data.websiteUrl || result.data.source !== 'DEFAULT') return null;
  const { m } = await getI18n();
  return (
    <aside aria-label={m.notices.brand.label} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <span className="flex items-center gap-3">
        <Palette aria-hidden className="h-5 w-5 text-indigo-ink" />
        {m.notices.brand.ask}
      </span>
      <span className="flex items-center gap-2">
        <Link href="/settings#brand" className={buttonVariants({ size: 'sm' })}>
          {m.notices.brand.add}
        </Link>
        <form action={skipBrandPrompt}>
          <Button type="submit" size="sm" variant="ghost">
            {m.notices.brand.skip}
          </Button>
        </form>
      </span>
    </aside>
  );
}
