import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { AuthFrame } from '../../_components/auth-frame';

/** Where an ended, expired or unknown shared-demo link lands (T-113). */
export default function DemoEndedPage() {
  return (
    <AuthFrame>
      <Card className="w-full shadow-xl shadow-navy/10">
        <CardHeader>
          <CardTitle>This demo has ended</CardTitle>
          <CardDescription>Shared Pactlab demos are open for a set time. Ask the person who sent you the link for a new one.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <a href="https://pactlab.ai" className="font-medium text-indigo-ink underline">
            Learn about Pactlab
          </a>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
