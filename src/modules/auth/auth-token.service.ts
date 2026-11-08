import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthTokenService {
  readonly expiresIn = 900;
  private readonly issuer = 'jornadatcg-api';
  private readonly audience = 'jornadatcg';

  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  private secret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || Buffer.byteLength(secret.trim()) < 32) {
      throw new ServiceUnavailableException('Autenticação não configurada.');
    }
    return secret;
  }

  assertConfigured(): void {
    this.secret();
  }

  async sign(userId: string, authVersion = 0): Promise<string> {
    if (
      !Number.isInteger(authVersion) ||
      authVersion < 0 ||
      authVersion > 2_147_483_647
    )
      throw new UnauthorizedException('Sessão inválida.');
    return this.jwt.signAsync(
      { ver: authVersion },
      {
        secret: this.secret(),
        algorithm: 'HS256',
        subject: userId,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.expiresIn,
      },
    );
  }

  async verify(token: string): Promise<string> {
    return (await this.verifyClaims(token)).userId;
  }

  async verifyClaims(
    token: string,
  ): Promise<{ userId: string; authVersion: number }> {
    const secret = this.secret();
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret,
          algorithms: ['HS256'],
          issuer: this.issuer,
          audience: this.audience,
          maxAge: this.expiresIn,
        },
      );
      if (
        typeof payload.sub !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          payload.sub,
        ) ||
        typeof payload.exp !== 'number' ||
        typeof payload.iat !== 'number' ||
        payload.exp - payload.iat > this.expiresIn ||
        (payload.ver !== undefined &&
          (typeof payload.ver !== 'number' ||
            !Number.isInteger(payload.ver) ||
            payload.ver < 0 ||
            payload.ver > 2_147_483_647))
      ) {
        throw new Error('Invalid claims');
      }
      return {
        userId: payload.sub,
        authVersion: (payload.ver as number | undefined) ?? 0,
      };
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
  }
}
