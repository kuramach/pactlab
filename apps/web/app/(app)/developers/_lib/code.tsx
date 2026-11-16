import type { ReactNode } from 'react';

/** A copyable code sample on the Developers pages (T-128). */
export function Code({ label, children }: { label: string; children: string }) {
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

/** A numbered step with a heading. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`step-${n}`}>
      <h3 id={`step-${n}`} className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-ink text-xs text-white">{n}</span> {title}
      </h3>
      <div className="flex flex-col gap-3 pl-8 text-sm">{children}</div>
    </section>
  );
}

/** Whether the API and MCP are on for the person's organization (`/v1/me/developer-access`). */
export interface DeveloperAccess {
  apiEnabled: boolean;
  mcpEnabled: boolean;
  pactlabSignIn: boolean;
}
