import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth.types.js';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (
      context.switchToHttp().getRequest<AuthenticatedRequest>().user?.role !==
      'ADMIN'
    ) {
      throw new ForbiddenException('Acesso restrito a administradores.');
    }
    return true;
  }
}
