import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { getSessionPermissions } from '../../../lib/session';
import { controlsByArea, openGaps, statusLabel, statusVariant } from './_lib/controls';

/**
 * Organization settings: the pilot control register an administrator walks a
 * design partner through. Each control links to the runbook that governs it;
 * open gaps are listed first and block calling the pilot ready.
 */
export default async function SettingsPage() {
  const permissions = await getSessionPermissions();
  if (!permissions.has('ORG_ADMIN')) {
    return (
      <EmptyState
        title="Organization administrators only"
        description="Sign in as an organization administrator to review pilot controls."
      />
    );
  }

  const gaps = openGaps();
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pilot controls</h1>
        <p className="text-sm text-muted-foreground">
          Controls, audit export and rollback paths for a limited design-partner pilot. Status is in
          place only when enforced by tested code or infrastructure.
        </p>
      </header>

      {gaps.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Open gaps</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm text-red-800">
              {gaps.map((control) => (
                <li key={control.id}>
                  {control.title}: {control.summary}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {controlsByArea().map((group) => (
        <Card key={group.area}>
          <CardHeader>
            <CardTitle>{group.area}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {group.controls.map((control) => (
                <li key={control.id} className="flex flex-wrap items-start gap-2 py-2">
                  <span className="mr-auto font-medium">{control.title}</span>
                  <Badge variant={statusVariant(control.status)}>
                    {statusLabel(control.status)}
                  </Badge>
                  <p className="w-full text-muted-foreground">{control.summary}</p>
                  <code className="w-full text-xs text-muted-foreground">{control.runbook}</code>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
