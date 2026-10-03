import { newId, type DealId, type OrganizationId, type TenantContext, type UserId } from '@pactlab/domain';

export interface SyntheticTenant {
  organizationId: string;
  auth0OrganizationId: string;
  userId: string;
  subject: string;
  dealId: string;
  dealName: string;
  fileId: string;
  context: TenantContext;
}

interface Executor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Insert one synthetic tenant (organization, user, membership, deal, deal
 * membership, stored file) as the schema owner. Synthetic data only.
 */
export async function createSyntheticTenant(db: Executor, label: string): Promise<SyntheticTenant> {
  const organizationId = newId();
  const userId = newId();
  const dealId = newId();
  const fileId = newId();
  const slug = `${label.toLowerCase()}-${organizationId.slice(-8)}`;
  const auth0OrganizationId = `org_${slug}`;
  const subject = `auth0|${slug}`;
  const dealName = `Project ${label}`;

  const statements: [string, unknown[]][] = [
    [
      `INSERT INTO organizations (id, name, slug, auth0_organization_id, updated_at) VALUES ($1, $2, $3, $4, now())`,
      [organizationId, `${label} Capital (synthetic)`, slug, auth0OrganizationId],
    ],
    [`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, $3)`, [userId, subject, `${label} Lead`]],
    [
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')`,
      [newId(), organizationId, userId],
    ],
    [
      `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at)
       VALUES ($1, $2, $3, $4, 'PRIVATE_ACQUIRER', $5, now())`,
      [dealId, organizationId, dealName, `${label} Target Software`, userId],
    ],
    [
      `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'DEAL_LEAD')`,
      [newId(), organizationId, dealId, userId],
    ],
    [
      `INSERT INTO stored_files (id, organization_id, deal_id, object_key, file_name, content_type, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, 'cim.pdf', 'application/pdf', 1024, $5)`,
      [fileId, organizationId, dealId, `${organizationId}/${dealId}/documents/cim.pdf`, '0'.repeat(64)],
    ],
  ];
  for (const [sql, params] of statements) await db.query(sql, params);

  return {
    organizationId,
    auth0OrganizationId,
    userId,
    subject,
    dealId,
    dealName,
    fileId,
    context: {
      organizationId: organizationId as OrganizationId,
      userId: userId as UserId,
      organizationRole: 'ORG_ADMIN',
      dealIds: [dealId as DealId],
    },
  };
}
