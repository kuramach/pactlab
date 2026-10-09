import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, Badge, Breadcrumbs, Button, cn, TabNav } from './index';

describe('ui', () => {
  it('merges conflicting Tailwind classes', () => {
    expect(cn('px-2', 'px-4', undefined, { hidden: false })).toBe('px-4');
  });

  it('renders buttons with an explicit type', () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('type="button"');
  });

  it('distinguishes provenance badges', () => {
    const draft = renderToStaticMarkup(<Badge variant="draft">Model draft</Badge>);
    const reviewed = renderToStaticMarkup(<Badge variant="reviewed">Reviewed</Badge>);
    expect(draft).not.toEqual(reviewed.replace('Reviewed', 'Model draft'));
  });

  it('shows the non-production banner only when labelled', () => {
    const frame = { sidebar: <nav>side</nav>, topbar: <div>top</div> };
    expect(renderToStaticMarkup(<AppShell {...frame} environmentLabel="local">x</AppShell>)).toContain(
      'Non-production environment: local',
    );
    expect(renderToStaticMarkup(<AppShell {...frame}>x</AppShell>)).not.toContain('Non-production');
  });

  it('links every breadcrumb but the current page', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs items={[{ href: '/', label: 'Home' }, { href: '/deals', label: 'My deals' }, { label: 'Project X' }]} />,
    );
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/deals"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('href="undefined"');
  });

  it('marks the active tab', () => {
    const html = renderToStaticMarkup(
      <TabNav label="Deal" items={[{ href: '/a', label: 'A', active: true }, { href: '/b', label: 'B' }]} />,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
