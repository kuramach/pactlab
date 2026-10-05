import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, Principal } from './auth.guard';

/** Inject the verified principal established by AuthGuard (scoped or unscoped). */
export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (!principal) throw new UnauthorizedException();
  return principal;
});
