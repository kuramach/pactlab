'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, dealsApi } from '../../../_lib/api';

const form = z.strictObject({
  repository: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/).optional(),
  jiraSite: z.string().regex(/^[a-z0-9-]+\.atlassian\.net$/).optional(),
  projectKeys: z.string().regex(/^[A-Z0-9,]+$/).optional(),
});

/**
 * Connect synthetic test data to this deal and sync it at once: a repository,
 * a Jira site, or both. Available only where the API allows fixture data.
 */
export async function connectSynthetic(dealId: string, formData: FormData): Promise<void> {
  if (!z.uuid().safeParse(dealId).success) redirect('/deals');
  const value = (name: string) => {
    const raw = formData.get(name);
    return typeof raw === 'string' && raw !== '' ? raw : undefined;
  };
  // The Jira option carries its own project keys: "site|KEY1,KEY2".
  const [jiraSite, projectKeys] = (value('jiraSite') ?? '').split('|');
  const parsed = form.safeParse({ repository: value('repository'), jiraSite: jiraSite || undefined, projectKeys: projectKeys || undefined });
  if (!parsed.success || (!parsed.data.repository && !parsed.data.jiraSite)) redirect(`/deals/${dealId}/sources/synthetic?outcome=choose`);
  const { repository } = parsed.data;
  const site = parsed.data.jiraSite;
  const keys = parsed.data.projectKeys;
  const connections = [
    ...(repository ? [{ provider: 'github', displayName: `${repository} (synthetic)`, mode: 'FIXTURE', config: { repository } }] : []),
    ...(site
      ? [{ provider: 'jira', displayName: `${site} (synthetic)`, mode: 'FIXTURE', config: { site, projectKeys: (keys ?? '').split(',').filter(Boolean) } }]
      : []),
  ];
  for (const body of connections) {
    const created = await apiPost<{ id: string }>(`/v1/deals/${dealId}/connections`, body);
    if (created.kind !== 'ok') redirect(`/deals/${dealId}/sources/synthetic?outcome=${created.kind}`);
    await dealsApi.requestSync(dealId, created.data.id, `web-${randomUUID()}`);
  }
  redirect(`/deals/${dealId}/engineering`);
}
