'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, dealsApi } from '../../../_lib/api';

/** The Kafka demo pair (T-127): real public data, recorded once and replayed; never synthetic, never live. */
const KAFKA_REPOSITORY = 'apache/kafka';
const KAFKA_SITE = 'issues.apache.org';
const RECORDED = 'real public data, recorded once';

const form = z.strictObject({
  repository: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/).optional(),
  jiraSite: z.union([z.string().regex(/^[a-z0-9-]+\.atlassian\.net$/), z.literal(KAFKA_SITE)]).optional(),
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
    ...(repository ? [{ provider: 'github', displayName: `${repository} (${repository === KAFKA_REPOSITORY ? RECORDED : 'synthetic'})`, mode: 'FIXTURE', config: { repository } }] : []),
    ...(site
      ? [
          {
            provider: 'jira',
            displayName: site === KAFKA_SITE ? `Apache Jira (${RECORDED})` : `${site} (synthetic)`,
            mode: 'FIXTURE',
            config: { site, ...(site === KAFKA_SITE ? { basePath: '/jira' } : {}), projectKeys: (keys ?? '').split(',').filter(Boolean) },
          },
        ]
      : []),
  ];
  for (const body of connections) {
    const created = await apiPost<{ id: string }>(`/v1/deals/${dealId}/connections`, body);
    if (created.kind !== 'ok') redirect(`/deals/${dealId}/sources/synthetic?outcome=${created.kind}`);
    await dealsApi.requestSync(dealId, created.data.id, `web-${randomUUID()}`);
  }
  redirect(`/deals/${dealId}/engineering`);
}
