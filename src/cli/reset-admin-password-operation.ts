import type { PrismaService } from '../database/prisma.service.js';
import type { PasswordService } from '../modules/auth/password.service.js';
import { RegisterBodyPipe } from '../modules/auth/dto/auth.dto.js';

export class LocalRecoveryError extends Error {}

/** Trusted local recovery only. No HTTP endpoint and no role or account creation. */
export async function resetAdminPassword(
  db: PrismaService,
  passwords: PasswordService,
  email: string,
  password: string,
): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new LocalRecoveryError(
      'Este comando local não está disponível em produção.',
    );
  let input;
  try {
    input = new RegisterBodyPipe().transform({
      name: 'Administrador',
      email,
      password,
    });
  } catch {
    throw new LocalRecoveryError(
      'Informe um e-mail válido e uma senha de 12 a 128 caracteres.',
    );
  }
  try {
    const user = await db.user.findUnique({
      where: { email: input.email },
      select: { id: true, role: true },
    });
    if (!user || user.role !== 'ADMIN')
      throw new Error('Conta administrativa não encontrada.');
    const passwordHash = await passwords.hash(input.password);
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 1))::text`;
        const now = new Date();
        const changed = await tx.user.updateMany({
          where: { id: user.id, email: input.email, role: 'ADMIN' },
          data: { passwordHash, authVersion: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new Error('Conta administrativa não encontrada.');
        await tx.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now },
        });
      },
      { maxWait: 5000, timeout: 5000 },
    );
  } catch {
    throw new LocalRecoveryError(
      'Não foi possível redefinir a senha. Confira a conta administrativa e a conexão com o banco.',
    );
  }
}
