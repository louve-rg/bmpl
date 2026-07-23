import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission, RoleCode } from '@bmpl/shared';
import type { AuthContext } from './auth-context';

/** Marks a route as not requiring authentication. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires the caller to hold at least one of these roles as APPROVED. */
export const ROLES_KEY = 'requiredRoles';
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);

/** Requires the caller to hold ALL of these admin permissions. */
export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Injects the authenticated principal into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    if (!request.auth) {
      throw new Error('CurrentUser used on a route without JwtAuthGuard');
    }
    return request.auth;
  },
);
