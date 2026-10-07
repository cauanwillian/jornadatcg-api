import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { publicUserSelect } from './auth.types.js';
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
@Injectable()
export class RefreshSessionService {
  readonly maxAge = 30 * 24 * 60 * 60 * 1000;
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
  ) {}
  private valid(token?: string): token is string {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{64}$/.test(token);
  }
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        'Sessão temporariamente indisponível.',
      );
    }
  }
  issue(userId: string) {
    return this.safe(async () => {
      const token = randomBytes(48).toString('base64url');
      await this.db.refreshToken.create({
        data: {
          userId,
          familyId: randomUUID(),
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + this.maxAge),
        },
      });
      return token;
    });
  }
  rotate(token?: string) {
    return this.safe(async () => {
      if (!this.valid(token))
        throw new UnauthorizedException('Sessão inválida ou expirada.');
      const row = await this.db.refreshToken.findUnique({
        where: { tokenHash: hash(token) },
      });
      if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now())
        throw new UnauthorizedException('Sessão inválida ou expirada.');
      const next = randomBytes(48).toString('base64url');
      const result = await this.db.$transaction(async (tx) => {
        // Serialize refresh and logout across all API instances for this session.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.familyId}, 0))::text`;
        const claimed = await tx.refreshToken.updateMany({
          where: {
            id: row.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) {
          await tx.refreshToken.updateMany({
            where: { familyId: row.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          return null;
        }
        const user = await tx.user.findUnique({
          where: { id: row.userId },
          select: publicUserSelect,
        });
        if (!user)
          throw new UnauthorizedException('Sessão inválida ou expirada.');
        const accessToken = await this.tokens.sign(user.id);
        await tx.refreshToken.create({
          data: {
            userId: user.id,
            familyId: row.familyId,
            tokenHash: hash(next),
            expiresAt: row.expiresAt,
          },
        });
        return {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: this.tokens.expiresIn,
          user,
        };
      });
      if (!result) {
        throw new UnauthorizedException(
          'Sessão reutilizada. Faça login novamente.',
        );
      }
      return {
        body: result,
        token: next,
        maxAge: Math.max(0, row.expiresAt.getTime() - Date.now()),
      };
    });
  }
  logout(token?: string) {
    return this.safe(async () => {
      if (!this.valid(token)) return;
      const row = await this.db.refreshToken.findUnique({
        where: { tokenHash: hash(token) },
      });
      if (row)
        await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.familyId}, 0))::text`;
          await tx.refreshToken.updateMany({
            where: { familyId: row.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        });
    });
  }
}
