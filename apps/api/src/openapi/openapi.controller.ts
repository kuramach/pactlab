import { Controller, Get, Header, Inject, type Type } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Public } from '../auth/auth.guard';
import { OAUTH, type OAuthDependencies } from '../oauth/oauth.service';
import { apiOperations, openApiDocument } from './spec';

/** The API reference (T-128): OpenAPI 3.1, generated from the routes open to API tokens. Public. */
@Controller('v1')
export class OpenApiController {
  private document: ReturnType<typeof openApiDocument> | null = null;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(OAUTH) private readonly deps: OAuthDependencies,
  ) {}

  @Public()
  @Get('openapi.json')
  @Header('cache-control', 'public, max-age=300')
  @Header('access-control-allow-origin', '*')
  spec() {
    this.document ??= openApiDocument(
      apiOperations(this.discovery.getControllers().flatMap((wrapper) => (wrapper.metatype ? [wrapper.metatype as Type] : []))),
      { api: new URL(this.deps.apiTokens.resource).origin, issuer: this.deps.apiTokens.issuer },
    );
    return this.document;
  }
}
