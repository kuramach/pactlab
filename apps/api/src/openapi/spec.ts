import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { z } from 'zod';
import { apiRouteDoc, type ApiRouteDoc } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/** One route open to API tokens, read from Nest's own metadata. */
export interface ApiOperation {
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** OpenAPI form: `/v1/deals/{dealId}`. */
  readonly path: string;
  readonly doc: ApiRouteDoc;
  readonly scope: 'api:read' | 'api:write';
  readonly params: z.ZodType | null;
  readonly query: z.ZodType | null;
  readonly body: z.ZodType | null;
  /** The query is `pageQuerySchema`-shaped, so the answer is a `Page` (T-126). */
  readonly paged: boolean;
}

const METHODS: Partial<Record<RequestMethod, ApiOperation['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

const joinPath = (...parts: string[]) =>
  `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

function argSchema(args: Record<string, { pipes?: unknown[] }>, type: RouteParamtypes): z.ZodType | null {
  for (const [key, arg] of Object.entries(args)) {
    if (Number(key.split(':')[0]) !== type) continue;
    const pipe = arg.pipes?.find((entry): entry is ZodValidationPipe<z.ZodType> => entry instanceof ZodValidationPipe);
    if (pipe) return pipe.schema;
  }
  return null;
}

const shapeOf = (schema: z.ZodType | null): Record<string, z.ZodType> => (schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodType>) : {});

/**
 * Every route marked `@ApiAccess(...)` in these controllers, with the Zod schemas that validate
 * it. The reference is generated from what the code enforces, so the two cannot drift.
 */
export function apiOperations(controllers: readonly Type[]): ApiOperation[] {
  const operations: ApiOperation[] = [];
  for (const controller of controllers) {
    const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === 'constructor') continue;
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const doc = apiRouteDoc(handler);
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      if (!doc || !method) continue;
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<string, { pipes?: unknown[] }>;
      const query = argSchema(args, RouteParamtypes.QUERY);
      const queryShape = shapeOf(query);
      operations.push({
        method,
        path: joinPath(base, (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? ''),
        doc,
        scope: method === 'get' ? 'api:read' : 'api:write',
        params: argSchema(args, RouteParamtypes.PARAM),
        query,
        body: argSchema(args, RouteParamtypes.BODY),
        paged: 'cursor' in queryShape && 'limit' in queryShape,
      });
    }
  }
  return operations.sort((a, b) => a.doc.tag.localeCompare(b.doc.tag) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;

function parameters(operation: ApiOperation) {
  const of = (schema: z.ZodType | null, where: 'path' | 'query') => {
    if (!schema) return [];
    const json = jsonSchema(schema) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
    return Object.entries(json.properties ?? {}).map(([name, property]) => ({
      name,
      in: where,
      required: where === 'path' || (json.required ?? []).includes(name),
      schema: property,
      ...(typeof property['description'] === 'string' ? { description: property['description'] } : {}),
    }));
  };
  return [...of(operation.params, 'path'), ...of(operation.query, 'query')];
}

const problem = { $ref: '#/components/responses/Problem' };

/** The OpenAPI 3.1 document for the API (T-128). */
export function openApiDocument(operations: readonly ApiOperation[], origins: { api: string; issuer: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const methods = (paths[operation.path] ??= {});
    methods[operation.method] = {
      tags: [operation.doc.tag],
      summary: operation.doc.summary,
      description: operation.doc.description,
      operationId: `${operation.method}${operation.path.replace(/\{([^}]+)\}/g, 'By_$1').replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ?? '').toUpperCase())}`,
      security: [{ pactlab: [operation.scope] }],
      'x-pactlab-scope': operation.scope,
      parameters: parameters(operation),
      ...(operation.body ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(operation.body) } } } } : {}),
      responses: {
        [operation.method === 'post' ? '2XX' : '200']: {
          description: operation.paged ? 'A page of results (`items`, `nextCursor`, `total`, `limit`). Pass `nextCursor` as `cursor` for the next page.' : 'The result.',
          content: { 'application/json': { schema: operation.paged ? { $ref: '#/components/schemas/Page' } : { type: 'object' } } },
        },
        400: problem,
        401: problem,
        403: problem,
        404: problem,
        429: problem,
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Pactlab API',
      version: '1',
      description:
        'Everything you can see in Pactlab, for your own scripts and apps. Every call is made as you, with your role’s limits, and is audited under your name. Sign in a script with the device flow; apps use the authorization code flow with PKCE.',
    },
    servers: [{ url: origins.api }],
    tags: [...new Set(operations.map((operation) => operation.doc.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        pactlab: {
          type: 'oauth2',
          description: 'Per-person OAuth 2.1. Tokens last an hour; refresh tokens rotate. Ask for api:write only if your script changes things.',
          flows: {
            deviceAuthorization: { deviceAuthorizationUrl: `${origins.api}/v1/oauth/device_authorization`, tokenUrl: `${origins.api}/v1/oauth/token`, scopes: SCOPES },
            authorizationCode: { authorizationUrl: `${origins.issuer}/oauth/authorize`, tokenUrl: `${origins.api}/v1/oauth/token`, refreshUrl: `${origins.api}/v1/oauth/token`, scopes: SCOPES },
          },
        },
      },
      schemas: {
        Page: {
          type: 'object',
          required: ['items', 'nextCursor', 'total', 'limit'],
          properties: {
            items: { type: 'array', items: { type: 'object' } },
            nextCursor: { type: ['string', 'null'], description: 'Pass as `cursor` for the next page; null on the last page.' },
            total: { type: 'integer', description: 'Rows matching, across every page.' },
            limit: { type: 'integer', description: 'Page size (default 50, at most 100).' },
          },
        },
        Problem: {
          type: 'object',
          description: 'RFC 9457 problem details. `code` is stable; branch on it, not on the title.',
          required: ['type', 'title', 'status', 'code'],
          properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string' }, requestId: { type: 'string' } },
        },
      },
      responses: {
        Problem: { description: 'An error, as problem details.', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
      },
    },
  };
}

const SCOPES = {
  'api:read': 'Read what you can see: pacts, documents, findings, evidence, valuation and reports.',
  'api:write': 'Also make the changes your role allows (draft findings, uploads, document requests). Approvals stay in the app.',
};
