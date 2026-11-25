import { PageHeader, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, StepPanel } from '@pactlab/ui';
import { Lightbulb } from 'lucide-react';

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
      <Card>
        <CardHeader>
          <CardTitle>Step panel</CardTitle>
          <CardDescription>The one way to step through items: the guided tour and What’s new. Approved 2026-11-25; see docs/ui-patterns.md.</CardDescription>
        </CardHeader>
        <CardContent>
          <StepPanel
            label="Step panel example"
            icon={<Lightbulb />}
            eyebrow="Tour · 2 of 9"
            title="A step’s title"
            actions={
              <>
                <Button type="button" size="sm" variant="outline">
                  Back
                </Button>
                <Button type="button" size="sm">
                  Next
                </Button>
              </>
            }
          >
            <p className="text-slate-text">What this step shows, in a sentence or two.</p>
          </StepPanel>
        </CardContent>
      </Card>
      <EmptyState title="Empty state" description="Used when a list has no rows the viewer is permitted to see." />
    </div>
  );
}
