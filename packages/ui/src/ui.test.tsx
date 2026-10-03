import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, Badge, Button, cn } from './index';

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
    const nav = [{ href: '/', label: 'Overview', active: true }];
    expect(renderToStaticMarkup(<AppShell nav={nav} environmentLabel="local">x</AppShell>)).toContain(
      'Non-production environment: local',
    );
    expect(renderToStaticMarkup(<AppShell nav={nav}>x</AppShell>)).not.toContain('Non-production');
  });
});
