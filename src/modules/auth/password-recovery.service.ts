import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { PasswordResetEmailService } from './password-reset-email.service.js';
import type {
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password-recovery.dto.js';

export const recoveryAccepted = {
  message:
    'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.',
};
export const recoveryCompleted = {
  message: 'Senha redefinida. Entre novamente com sua nova senha.',
};
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const lifetimeMs = 15 * 60_000;
const cooldownMs = 60_000;
const minimumResponseMs = 250;
const maxPendingEmails = 20;
const invalidLink = () =>
  new BadRequestException(
    'Link de recuperação inválido ou expirado. Solicite um novo link.',
  );

@Injectable()
export class PasswordRecoveryService implements OnModuleDestroy {
  private readonly logger = new Logger(PasswordRecoveryService.name);
  private readonly emails = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(PasswordResetEmailService)
    private readonly mail: PasswordResetEmailService,
  ) {}

  async request(input: ForgotPasswordDto): Promise<{ message: string }> {
    const started = Date.now();
    let delivery: { to: string; token: string } | null = null;
    try {
      // Configuration errors are independent of whether the supplied account exists.
      this.mail.assertConfigured();
      if (this.stopped || this.emails.size >= maxPendingEmails)
        throw new ServiceUnavailableException(
          'Recuperação de senha temporariamente indisponível.',
        );
      try {
        const token = randomBytes(32).toString('base64url');
        const user = await this.db.user.findUnique({
          where: { email: input.email },
          select: { id: true, email: true },
        });
        if (user) {
          delivery = await this.db.$transaction(
            async (tx) => {
              // The same user lock also serializes password reset and session issuance.
              await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 1))::text`;
              const current = await tx.user.findUnique({
                where: { id: user.id },
                select: { email: true, authVersion: true },
              });
              if (!current || current.email !== input.email) return null;
              const now = new Date();
              const recent = await tx.passwordResetToken.findFirst({
                where: {
                  userId: user.id,
                  createdAt: { gte: new Date(now.getTime() - cooldownMs) },
                },
                select: { id: true },
              });
              if (recent) return null;
              await tx.passwordResetToken.deleteMany({
                where: {
                  userId: user.id,
                  OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }],
                },
              });
              await tx.passwordResetToken.create({
                data: {
                  userId: user.id,
                  tokenHash: tokenHash(token),
                  authVersion: current.authVersion,
                  expiresAt: new Date(now.getTime() + lifetimeMs),
                },
              });
              return { to: current.email, token };
            },
            { maxWait: 5_000, timeout: 5_000 },
          );
        }
      } catch {
        // Lookup and token persistence failures must not identify registered accounts.
        this.logger.warn(
          'Não foi possível processar uma solicitação de recuperação.',
        );
      }
    } catch (error) {
      this.databaseError(error);
    } finally {
      // Delivery latency must never become a signal for account existence.
      const remaining = minimumResponseMs - (Date.now() - started);
      if (remaining > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }
    if (delivery) this.deliverLater(delivery);
    return { ...recoveryAccepted };
  }

  async reset(input: ResetPasswordDto): Promise<{ message: string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw invalidLink();
    try {
      const row = await this.db.passwordResetToken.findUnique({
        where: { tokenHash: tokenHash(input.token) },
        select: {
          id: true,
          userId: true,
          authVersion: true,
          expiresAt: true,
          usedAt: true,
        },
      });
      if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now())
        throw invalidLink();
      // Password derivation runs before opening a transaction and acquiring locks.
      const passwordHash = await this.passwords.hash(input.password);
      await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.userId}, 1))::text`;
          const now = new Date();
          const claimed = await tx.passwordResetToken.updateMany({
            where: {
              id: row.id,
              userId: row.userId,
              authVersion: row.authVersion,
              usedAt: null,
              expiresAt: { gt: now },
            },
            data: { usedAt: now },
          });
          if (claimed.count !== 1) throw invalidLink();
          const changed = await tx.user.updateMany({
            where: { id: row.userId, authVersion: row.authVersion },
            data: { passwordHash, authVersion: { increment: 1 } },
          });
          if (changed.count !== 1) throw invalidLink();
          await tx.refreshToken.updateMany({
            where: { userId: row.userId, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.passwordResetToken.updateMany({
            where: { userId: row.userId, usedAt: null },
            data: { usedAt: now },
          });
        },
        { maxWait: 5_000, timeout: 5_000 },
      );
      return { ...recoveryCompleted };
    } catch (error) {
      this.databaseError(error);
    }
  }

  private deliverLater(delivery: { to: string; token: string }): void {
    if (this.stopped || this.emails.size >= maxPendingEmails) {
      this.logger.warn(
        'Envio de recuperação indisponível. Solicite novamente após a espera.',
      );
      return;
    }
    const task = new Promise<void>((resolve) => {
      setImmediate(() => {
        if (this.stopped) {
          resolve();
          return;
        }
        void Promise.resolve()
          .then(() => this.mail.sendReset(delivery.to, delivery.token))
          .catch(() => {
            // SMTP errors can contain credentials, recipient details and the recovery URL.
            this.logger.warn(
              'Não foi possível entregar um e-mail de recuperação.',
            );
          })
          .finally(resolve);
      });
    });
    this.emails.add(task);
    void task.then(() => this.emails.delete(task));
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  private databaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Recuperação de senha temporariamente indisponível.',
    );
  }
}
