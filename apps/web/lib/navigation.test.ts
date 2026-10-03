import { describe, expect, it } from 'vitest';
import { permissionsForDealRole, permissionsForOrganizationRole } from '@pactlab/domain';
import { visibleNavigation } from './navigation';

describe('visibleNavigation', () => {
  it('shows only public entries without a session', () => {
    expect(visibleNavigation(new Set()).map((item) => item.label)).toEqual(['Overview', 'Design system']);
  });

  it('shows deals but not organization admin to a target contributor', () => {
    const labels = visibleNavigation(permissionsForDealRole('TARGET_CONTRIBUTOR')).map((item) => item.label);
    expect(labels).toContain('Deals');
    expect(labels).not.toContain('Organization');
    expect(labels).not.toContain('Audit log');
  });

  it('shows administration to organization admins', () => {
    expect(visibleNavigation(permissionsForOrganizationRole('ORG_ADMIN')).map((item) => item.label)).toContain(
      'Organization',
    );
  });
});
