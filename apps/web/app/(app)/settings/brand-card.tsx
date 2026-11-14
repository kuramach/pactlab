import type { BrandKitView } from '@pactlab/contracts';
import { BRAND_FONT_LABELS, BRAND_FONTS, PACTLAB_BRAND } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { CopyButton } from '../_lib/copy-button';
import { apiGet } from '../deals/_lib/api';
import { serverEnv } from '../../../lib/env';
import { applyBrandDraft, fetchBrandAgain, revertBrand, saveBrandKit, saveBrandWebsite, uploadBrandLogo } from './brand-actions';

const OUTCOMES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  fetching: { tone: 'ok', text: 'Reading your website. The suggestions appear here in a few seconds: refresh the page to see them.' },
  applied: { tone: 'ok', text: 'The suggestions are applied.' },
  saved: { tone: 'ok', text: 'Saved.' },
  reverted: { tone: 'ok', text: 'Back to the Pactlab look.' },
  'website-invalid': { tone: 'error', text: 'Enter your website as an https address, for example https://example.com.' },
  'logo-missing': { tone: 'error', text: 'Choose a logo file first.' },
  'logo-too-large': { tone: 'error', text: 'That logo is over 512 KB. Use a smaller PNG, JPEG or SVG.' },
  'logo-type': { tone: 'error', text: 'Use a PNG, JPEG or SVG logo.' },
  error: { tone: 'error', text: 'That did not work. Try again.' },
};

const SOURCE_LABELS: Record<BrandKitView['source'], string> = { DEFAULT: 'Pactlab look', EXTRACTED: 'From your website', EDITED: 'Set by an administrator' };

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function Swatch({ color, label }: { color: string | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className="h-5 w-5 rounded border border-border" style={{ background: color ?? 'transparent' }} />
      {label}: {color ?? 'none'}
    </span>
  );
}

/**
 * Settings → Brand (T-123): your logo, colors and font across Pactlab, drafted from your website
 * and reviewed by an owner or admin. Members see the current kit.
 */
export async function BrandCard({ outcome }: { outcome?: string | undefined }) {
  const result = await apiGet<BrandKitView>('/v1/organization/brand');
  if (result.kind !== 'ok') return null;
  const kit = result.data;
  const message = outcome ? OUTCOMES[outcome] : undefined;
  const signInLink = `${serverEnv().APP_BASE_URL ?? ''}/login/${kit.slug}`;
  return (
    <Card id="brand">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Brand <Badge variant="neutral">{SOURCE_LABELS[kit.source]}</Badge>
        </CardTitle>
        <CardDescription>
          Your logo, colors and font on Pactlab: top left after sign-in, on your sign-in page and in the tab. Give your website and Pactlab suggests them; nothing changes until you apply it. Findings,
          valuation and terms are never affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className="rounded-md border border-border bg-muted px-3 py-2">
            {message.text}
          </p>
        ) : null}

        <section aria-label="Current brand" className="flex flex-wrap items-center gap-6 rounded-lg border border-border p-4">
          {kit.hasLogo ? (
            <img src={`/brand-logo?v=${encodeURIComponent(kit.version)}`} alt={`${kit.organizationName} logo`} className="h-10 w-auto max-w-[12rem] object-contain" />
          ) : (
            <span className="text-muted-foreground">No logo: the Pactlab logo is shown.</span>
          )}
          <Swatch color={kit.accentColor ?? PACTLAB_BRAND.accentColor} label="Accent" />
          <span>Font: {BRAND_FONT_LABELS[kit.font]}</span>
          {kit.accentAdjusted ? <span className="text-muted-foreground">Text and links use {kit.accentReadable}, a darker shade, so they stay readable.</span> : null}
        </section>

        {kit.canEdit ? (
          <>
            <form action={saveBrandWebsite} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 font-medium">
                Company website
                <input name="websiteUrl" type="text" inputMode="url" defaultValue={kit.websiteUrl ?? ''} placeholder="https://example.com" className={inputClass} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" variant="outline">
                  Save and fetch from website
                </Button>
                {kit.websiteUrl ? (
                  <Button type="submit" size="sm" variant="ghost" formAction={fetchBrandAgain}>
                    Fetch again
                  </Button>
                ) : null}
              </div>
            </form>

            {kit.draft ? (
              <section aria-label="Suggested from your website" className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
                <p className="font-semibold">Suggested from {kit.draft.websiteUrl}</p>
                <div className="flex flex-wrap items-center gap-6">
                  {kit.draft.hasLogo ? (
                    <img src={`/brand-logo?which=draft&v=${encodeURIComponent(kit.draft.extractedAt)}`} alt="Suggested logo" className="h-10 w-auto max-w-[12rem] object-contain" />
                  ) : null}
                  <Swatch color={kit.draft.accentColor} label="Accent" />
                  <span>Font: {BRAND_FONT_LABELS[kit.draft.font]}</span>
                </div>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {kit.draft.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <form action={applyBrandDraft}>
                  <Button type="submit" size="sm">
                    Apply these
                  </Button>
                </form>
              </section>
            ) : null}

            <form action={uploadBrandLogo} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 font-medium">
                Upload a logo (PNG, JPEG or SVG, up to 512 KB)
                <input name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml" className="text-sm" />
              </label>
              <div>
                <Button type="submit" size="sm" variant="outline">
                  Upload logo
                </Button>
              </div>
            </form>

            <form action={saveBrandKit} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="useAccent" defaultChecked={kit.accentColor !== null} />
                  Accent color
                  <input type="color" name="accentColor" defaultValue={kit.accentColor ?? PACTLAB_BRAND.accentColor} aria-label="Accent color" />
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="usePrimary" defaultChecked={kit.primaryColor !== null} />
                  Primary color (documents)
                  <input type="color" name="primaryColor" defaultValue={kit.primaryColor ?? PACTLAB_BRAND.primaryColor} aria-label="Primary color" />
                </label>
                <label className="flex items-center gap-2">
                  Font
                  <select name="font" defaultValue={kit.font} className="rounded-md border border-border bg-background px-2 py-1">
                    {BRAND_FONTS.map((font) => (
                      <option key={font} value={font}>
                        {BRAND_FONT_LABELS[font]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" variant="outline">
                  Save colors and font
                </Button>
                {kit.source !== 'DEFAULT' ? (
                  <Button type="submit" size="sm" variant="ghost" formAction={revertBrand}>
                    Revert to the Pactlab look
                  </Button>
                ) : null}
              </div>
            </form>
          </>
        ) : (
          <p className="text-muted-foreground">Owners and administrators can change the brand.</p>
        )}

        {kit.source !== 'DEFAULT' ? (
          <section aria-label="Your sign-in page" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
            <span>
              Your sign-in page: <span className="font-mono text-xs">{signInLink}</span>
            </span>
            <CopyButton text={signInLink} label="Copy link" />
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
