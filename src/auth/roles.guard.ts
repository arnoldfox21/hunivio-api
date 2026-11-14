import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './jwt-auth.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRole = (req.user?.role || '').toUpperCase();
    if (!requiredRoles.map((r) => r.toUpperCase()).includes(userRole)) {
      throw new ForbiddenException(
        'Anda tidak memiliki hak akses untuk tindakan ini.',
      );
    }
    return true;
  }
}
