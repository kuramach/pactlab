import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import type { AuthenticatedRequest } from './auth.guard';

/** Inject the verified tenant context established by AuthGuard. */
export const Tenant = createParamDecorator((_data: unknown, context: ExecutionContext): TenantContext => {
  const tenant = context.switchToHttp().getRequest<AuthenticatedRequest>().tenant;
  if (!tenant) throw new UnauthorizedException();
  return tenant;
});
