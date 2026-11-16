import { Badge } from '@pactlab/ui';

type JsonSchema = { type?: string | string[]; enum?: unknown[]; format?: string; items?: JsonSchema; anyOf?: JsonSchema[]; minimum?: number; maximum?: number; default?: unknown };
interface Parameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: JsonSchema;
}
interface Operation {
  tags: string[];
  summary: string;
  description: string;
  'x-pactlab-scope': string;
  parameters: Parameter[];
  requestBody?: { content: { 'application/json': { schema: unknown } } };
  responses: Record<string, { description: string }>;
}
export interface OpenApiSpec {
  servers: { url: string }[];
  tags: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
}

const METHOD_STYLE: Record<string, string> = {
  get: 'bg-emerald-100 text-emerald-900',
  post: 'bg-indigo-100 text-indigo-900',
  put: 'bg-amber-100 text-amber-900',
  patch: 'bg-amber-100 text-amber-900',
  delete: 'bg-red-100 text-red-900',
};

/** A schema in a few words: `string (uuid)`, `PRE | DILIGENCE | POST`, `integer 1–100, default 50`. */
export function describeSchema(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map(String).join(' | ');
  if (schema.anyOf) return schema.anyOf.map(describeSchema).join(' or ');
  const type = Array.isArray(schema.type) ? schema.type.join(' or ') : (schema.type ?? 'any');
  const items = schema.items ? ` of ${describeSchema(schema.items)}` : '';
  const format = schema.format ? ` (${schema.format})` : '';
  const range = schema.minimum !== undefined && schema.maximum !== undefined ? ` ${schema.minimum}–${schema.maximum}` : '';
  const fallback = schema.default !== undefined ? `, default ${JSON.stringify(schema.default)}` : '';
  return `${type}${items}${format}${range}${fallback}`;
}

/** The API reference (T-128), rendered from `/v1/openapi.json`: every route open to API tokens, by area. */
export function Reference({ spec }: { spec: OpenApiSpec }) {
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => ({ path, method, operation })));
  return (
    <div className="flex flex-col gap-6">
      {spec.tags.map((tag) => (
        <section key={tag.name} aria-labelledby={`tag-${tag.name}`} className="flex flex-col gap-2">
          <h3 id={`tag-${tag.name}`} className="text-sm font-semibold">
            {tag.name}
          </h3>
          <ul className="flex flex-col gap-2">
            {operations
              .filter((entry) => entry.operation.tags.includes(tag.name))
              .map(({ path, method, operation }) => (
                <li key={`${method} ${path}`} className="rounded-lg border border-border">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold uppercase ${METHOD_STYLE[method] ?? ''}`}>{method}</span>
                      <code className="font-mono text-xs">{path}</code>
                      <span className="text-muted-foreground">{operation.summary}</span>
                      <Badge variant="neutral" className="ml-auto font-mono">
                        {operation['x-pactlab-scope']}
                      </Badge>
                    </summary>
                    <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-sm">
                      <p>{operation.description}</p>
                      {operation.parameters.length > 0 ? (
                        <table className="w-full text-left text-xs" aria-label={`Parameters of ${method.toUpperCase()} ${path}`}>
                          <thead className="uppercase text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-3">Name</th>
                              <th className="py-1 pr-3">In</th>
                              <th className="py-1 pr-3">Type</th>
                              <th className="py-1">Required</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {operation.parameters.map((parameter) => (
                              <tr key={`${parameter.in}:${parameter.name}`}>
                                <td className="py-1 pr-3 font-mono">{parameter.name}</td>
                                <td className="py-1 pr-3">{parameter.in}</td>
                                <td className="py-1 pr-3 font-mono">{describeSchema(parameter.schema)}</td>
                                <td className="py-1">{parameter.required ? 'yes' : 'no'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                      {operation.requestBody ? (
                        <div className="flex flex-col gap-1">
                          <p className="text-xs font-medium text-muted-foreground">Request body (JSON Schema)</p>
                          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted px-3 py-2 text-xs">{JSON.stringify(operation.requestBody.content['application/json'].schema, null, 2)}</pre>
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Returns: {Object.values(operation.responses)[0]?.description ?? 'the result.'} Errors are problem details with a stable <code>code</code>.
                      </p>
                    </div>
                  </details>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
