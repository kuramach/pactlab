import type { Metadata } from 'next';
import { CtaBand } from '../../../components/cta';
import { FeatureGrid } from '../../../components/features';
import { PageHero, Section } from '../../../components/page-hero';
import { API_AUTH, API_CONVENTIONS, API_CTA, API_ERROR_EXAMPLE, API_FAMILIES, API_MCP, API_ORIGIN, API_PAGE, MCP_TOOLS } from '../../../lib/api-docs';
import { siteConfig } from '../../../lib/config';
import { PILOT } from '../../../lib/content';
import { pageMetadata } from '../../../lib/seo';

export const metadata: Metadata = pageMetadata({ title: API_PAGE.metaTitle, description: API_PAGE.metaDescription, path: '/api' });

/** A code sample as plain <pre><code>, so crawlers and assistants can lift it intact. */
function CodeSample({ label, children }: { label: string; children: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs font-bold uppercase tracking-widest text-slate-text">{label}</figcaption>
      <pre className="overflow-x-auto rounded-xl bg-navy p-4 text-sm leading-relaxed text-white">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

/** /api (T-085 Part 6): the public, pre-login description of the REST API and the MCP server. */
export default function ApiPage() {
  const { loginUrl } = siteConfig();
  // The app sends a signed-out visitor to sign in and back to this page.
  const developersUrl = loginUrl ? new URL(API_CTA.path, loginUrl).toString() : null;
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'API', href: '/api' },
  ];
  return (
    <>
      <PageHero eyebrow={API_PAGE.eyebrow} title={API_PAGE.title} body={API_PAGE.body} icon="Plug" crumbs={crumbs}>
        {developersUrl ? (
          <a href={developersUrl} className="inline-flex w-fit items-center rounded-lg bg-white px-5 py-3 font-bold text-navy hover:bg-white/90">
            {API_CTA.label}
          </a>
        ) : null}
      </PageHero>

      <Section title={API_PAGE.purposeTitle}>
        <FeatureGrid features={API_PAGE.purpose} columns={2} />
      </Section>

      <Section title="Resources" body={`Base address ${API_ORIGIN}. Every example uses HealthyCo, a synthetic company; ids are illustrative and responses are shortened to the fields that matter.`} tone="mist">
        <div className="flex flex-col gap-12">
          {API_FAMILIES.map((family) => (
            <article key={family.slug} id={family.slug} className="flex flex-col gap-4">
              <h3 className="text-2xl font-bold text-navy">{family.name}</h3>
              <p className="max-w-3xl leading-relaxed text-slate-text">{family.body}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {family.operations.map((operation) => (
                  <li key={`${operation.method} ${operation.path}`}>
                    <code className="font-mono font-semibold text-navy">
                      {operation.method} {operation.path}
                    </code>{' '}
                    <span className="text-slate-text">— {operation.summary}</span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-4 lg:grid-cols-2">
                <CodeSample label="Request (curl)">{family.example.request}</CodeSample>
                <CodeSample label="Response (JSON)">{family.example.response}</CodeSample>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section title={API_AUTH.title} body={API_AUTH.body}>
        <div className="grid gap-8 lg:grid-cols-2">
          <dl className="flex flex-col gap-4">
            {API_AUTH.points.map((point) => (
              <div key={point.title}>
                <dt className="font-bold text-navy">{point.title}</dt>
                <dd className="mt-1 leading-relaxed text-slate-text">{point.body}</dd>
              </div>
            ))}
          </dl>
          <CodeSample label="Sign a script in (OAuth device flow)">{API_AUTH.example}</CodeSample>
        </div>
      </Section>

      <Section title="Pagination, errors, rate limits and versioning" tone="mist">
        <div className="grid gap-8 lg:grid-cols-2">
          <dl className="flex flex-col gap-4">
            {API_CONVENTIONS.map((item) => (
              <div key={item.title}>
                <dt className="font-bold text-navy">{item.title}</dt>
                <dd className="mt-1 leading-relaxed text-slate-text">{item.body}</dd>
              </div>
            ))}
          </dl>
          <CodeSample label="An error (application/problem+json)">{API_ERROR_EXAMPLE}</CodeSample>
        </div>
      </Section>

      <Section id="mcp" title={API_MCP.title} body={API_MCP.body}>
        <div className="flex flex-col gap-8">
          <CodeSample label="MCP server address">{API_MCP.address}</CodeSample>
          <p className="max-w-3xl leading-relaxed text-slate-text">{API_MCP.connect}</p>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-xl font-bold text-navy">Read tools</h3>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {MCP_TOOLS.read.map((tool) => (
                  <li key={tool.name}>
                    <code className="font-mono font-semibold text-navy">{tool.name}</code> <span className="text-slate-text">— {tool.body}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xl font-bold text-navy">Suggestions, decided by a person</h3>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {MCP_TOOLS.propose.map((tool) => (
                  <li key={tool.name}>
                    <code className="font-mono font-semibold text-navy">{tool.name}</code> <span className="text-slate-text">— {tool.body}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      <CtaBand title={PILOT.title} body={PILOT.body} />
    </>
  );
}
