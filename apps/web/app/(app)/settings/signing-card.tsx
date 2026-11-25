import type { SigningSettingsView } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { apiGet } from '../deals/_lib/api';
import { chooseSigningProvider } from './signing-actions';

const OUTCOMES: Record<string, string> = {
  'signing-saved': 'Saved. New envelopes go out with it; envelopes already sent finish on their own provider.',
  'signing-DOCUSIGN_NOT_CONNECTED': 'Connect your DocuSign account first, below.',
  forbidden: 'An organization owner or administrator chooses the signing provider.',
};

/**
 * Settings → Signing (T-136 item 9): Pactlab signing by default, or the organization's own connected
 * DocuSign. Changing it affects new envelopes only. When the chosen DocuSign is disconnected, new
 * envelopes fall back to Pactlab signing, and this card says so.
 */
export async function SigningCard({ outcome }: { outcome?: string }) {
  const result = await apiGet<SigningSettingsView>('/v1/organization/signing');
  if (result.kind !== 'ok') return null;
  const view = result.data;
  const message = outcome ? OUTCOMES[outcome] : undefined;
  return (
    <Card id="signing" section="signing">
      <CardHeader>
        <CardTitle>Signing</CardTitle>
        <CardDescription>How letters of intent and agreed terms are sent for signature. Envelopes already sent finish on the provider they went out with.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {message ? <p role="status">{message}</p> : null}
        <p>
          New envelopes go out with: <span className="font-semibold">{view.effective.provider ?? 'none (sign in Pactlab instead)'}</span>
        </p>
        {view.effective.note ? <p className="text-amber-900">{view.effective.note}</p> : null}
        <ul className="flex flex-col gap-2">
          {view.options.map((option) => (
            <li key={option.choice} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <div className="mr-auto flex flex-col gap-0.5">
                <span className="font-semibold">
                  {option.label} {view.current === option.choice ? <Badge variant="reviewed">Chosen</Badge> : null}
                </span>
                <span className="text-muted-foreground">{option.available ? option.detail : option.unavailableReason}</span>
              </div>
              {view.canEdit && view.current !== option.choice && option.available ? (
                <form action={chooseSigningProvider.bind(null, option.choice)}>
                  <Button type="submit" size="sm" variant="outline">
                    Use {option.label}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {!view.canEdit ? <p className="text-muted-foreground">An organization owner or administrator chooses this.</p> : null}
      </CardContent>
    </Card>
  );
}
