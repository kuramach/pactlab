import { PageHeader, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';

export default function DesignSystemPage() {
  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/settings', label: 'Settings' }, { label: 'Design system' }]}
        title="Design system"
        description="Shared components from @pactlab/ui."
      />
      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Provenance badges</CardTitle>
          <CardDescription>Source evidence, calculations, model drafts and reviewed decisions never look alike.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Badge variant="evidence">Source evidence</Badge>
          <Badge variant="calculation">Deterministic calculation</Badge>
          <Badge variant="draft">Model draft</Badge>
          <Badge variant="reviewed">Human reviewed</Badge>
          <Badge variant="danger">Blocked</Badge>
        </CardContent>
      </Card>
      <EmptyState title="Empty state" description="Used when a list has no rows the viewer is permitted to see." />
    </div>
  );
}
