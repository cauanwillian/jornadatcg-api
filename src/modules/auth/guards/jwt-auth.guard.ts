import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthTokenService } from '../auth-token.service.js';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../auth.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const match =
      typeof header === 'string' && header.length <= 4096
        ? /^Bearer (\S+)$/i.exec(header)
        : null;
    if (!match)
      throw new UnauthorizedException('Informe um token Bearer válido.');
    const id = await this.tokens.verify(match[1]);
    request.user = await this.auth.currentUser(id);
    return true;
  }
}
