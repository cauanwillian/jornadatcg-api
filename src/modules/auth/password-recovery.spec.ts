import { createHash } from 'node:crypto';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PasswordService } from './password.service.js';
import type { PasswordResetEmailService } from './password-reset-email.service.js';
import {
  PasswordRecoveryService,
  recoveryAccepted,
  recoveryCompleted,
} from './password-recovery.service.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const email = 'customer@example.com';
const rawToken = 'a'.repeat(43);
const password = '  new password preserved exactly  ';
const now = new Date('2026-11-04T12:00:00.000Z');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('Password recovery', () => {
  const db = {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    passwordResetToken: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    refreshToken: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  const passwords = { hash: vi.fn() };
  const mail = { assertConfigured: vi.fn(), sendReset: vi.fn() };
  let service: PasswordRecoveryService;

  async function finish<T>(promise: Promise<T>): Promise<T> {
    const outcome = promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const result = await outcome;
    if ('error' in result) throw result.error;
    return result.value;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.resetAllMocks();
    db.$transaction.mockImplementation((work) => work(db));
    db.user.findUnique.mockResolvedValue({ id: userId, email, authVersion: 3 });
    db.user.updateMany.mockResolvedValue({ count: 1 });
    db.passwordResetToken.findFirst.mockResolvedValue(null);
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-id',
      userId,
      authVersion: 3,
      usedAt: null,
      expiresAt: new Date(now.getTime() + 900_000),
    });
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    passwords.hash.mockResolvedValue('new-safe-hash');
    mail.sendReset.mockResolvedValue(undefined);
    service = new PasswordRecoveryService(
      db as unknown as PrismaService,
      passwords as unknown as PasswordService,
      mail as unknown as PasswordResetEmailService,
    );
  });
  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the same generic response for existing and unknown accounts', async () => {
    const known = await finish(service.request({ email }));
    db.user.findUnique.mockResolvedValue(null);
    const unknown = await finish(
      service.request({ email: 'missing@example.com' }),
    );
    expect(known).toEqual(recoveryAccepted);
    expect(unknown).toEqual(known);
    expect(mail.sendReset).toHaveBeenCalledTimes(1);
    expect(db.passwordResetToken.create).toHaveBeenCalledTimes(1);
  });

  it('stores only a hash of an unpredictable single-purpose expiring token', async () => {
    const result = await finish(service.request({ email }));
    const [recipient, token] = mail.sendReset.mock.calls[0];
    expect(recipient).toBe(email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.passwordResetToken.create).toHaveBeenCalledWith({
      data: {
        userId,
        tokenHash: hash(token),
        authVersion: 3,
        expiresAt: new Date(now.getTime() + 900_000),
      },
    });
    expect(
      JSON.stringify(db.passwordResetToken.create.mock.calls),
    ).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('serializes cooldown with the shared user lock and does not invalidate previous links on request', async () => {
    db.passwordResetToken.findFirst.mockResolvedValue({ id: 'previous-token' });
    expect(await finish(service.request({ email }))).toEqual(recoveryAccepted);
    expect(db.$queryRaw.mock.calls[0][1]).toBe(userId);
    expect(db.passwordResetToken.findFirst).toHaveBeenCalledWith({
      where: { userId, createdAt: { gte: new Date(now.getTime() - 60_000) } },
      select: { id: true },
    });
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(db.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(mail.sendReset).not.toHaveBeenCalled();
  });

  it('rechecks email ownership under lock before issuing a token', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ id: userId, email })
      .mockResolvedValueOnce({ email: 'changed@example.com', authVersion: 4 });
    expect(await finish(service.request({ email }))).toEqual(recoveryAccepted);
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail.sendReset).not.toHaveBeenCalled();
  });

  it('uses a minimum response duration without waiting for SMTP delivery', async () => {
    mail.sendReset.mockReturnValue(new Promise(() => {}));
    const outcome = service.request({ email });
    let completed = false;
    void outcome.then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(completed).toBe(false);
    expect(mail.sendReset).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual(recoveryAccepted);
    await vi.runAllTimersAsync();
    expect(mail.sendReset).toHaveBeenCalledTimes(1);
  });

  it('handles delivery failures without exposing account existence or SMTP credentials', async () => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    mail.sendReset.mockRejectedValue(
      new Error('smtp-secret raw-token recipient-private'),
    );
    expect(await finish(service.request({ email }))).toEqual(recoveryAccepted);
    expect(mail.sendReset).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      'Não foi possível entregar um e-mail de recuperação.',
    );
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /smtp-secret|recipient-private|raw-token/,
    );
  });

  it('rejects unavailable global delivery configuration before account lookup', async () => {
    mail.assertConfigured.mockImplementation(() => {
      throw new ServiceUnavailableException(
        'Recuperação de senha não configurada.',
      );
    });
    await expect(finish(service.request({ email }))).rejects.toMatchObject({
      status: 503,
    });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(mail.sendReset).not.toHaveBeenCalled();
  });

  it('masks account-specific database failures with the same generic accepted response', async () => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    db.passwordResetToken.create.mockRejectedValue(
      new Error('private-db-connection'),
    );
    expect(await finish(service.request({ email }))).toEqual(recoveryAccepted);
    db.user.findUnique.mockResolvedValue(null);
    expect(
      await finish(service.request({ email: 'unknown@example.com' })),
    ).toEqual(recoveryAccepted);
    expect(mail.sendReset).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      'Não foi possível processar uma solicitação de recuperação.',
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      'private-db-connection',
    );
  });

  it('masks failed account lookup without sending mail or exposing database state', async () => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    db.user.findUnique.mockRejectedValue(new Error('database credentials'));
    expect(await finish(service.request({ email }))).toEqual(recoveryAccepted);
    expect(mail.sendReset).not.toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      'database credentials',
    );
  });

  it('bounds pending deliveries and stops accepting work when shutting down', async () => {
    mail.sendReset.mockReturnValue(new Promise(() => {}));
    for (let index = 0; index < 20; index++)
      await finish(service.request({ email }));
    await expect(finish(service.request({ email }))).rejects.toMatchObject({
      status: 503,
    });
    expect(mail.sendReset).toHaveBeenCalledTimes(20);
    service.onModuleDestroy();
    await expect(finish(service.request({ email }))).rejects.toMatchObject({
      status: 503,
    });
  });

  it('atomically consumes the link, changes the password/version, and revokes every previous session', async () => {
    expect(await service.reset({ token: rawToken, password })).toEqual(
      recoveryCompleted,
    );
    expect(db.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hash(rawToken) },
      select: {
        id: true,
        userId: true,
        authVersion: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    expect(passwords.hash).toHaveBeenCalledWith(password);
    expect(passwords.hash.mock.invocationCallOrder[0]).toBeLessThan(
      db.$transaction.mock.invocationCallOrder[0],
    );
    expect(db.$queryRaw.mock.calls[0][1]).toBe(userId);
    expect(db.passwordResetToken.updateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 'reset-id',
        userId,
        authVersion: 3,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: userId, authVersion: 3 },
      data: { passwordHash: 'new-safe-hash', authVersion: { increment: 1 } },
    });
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    expect(db.passwordResetToken.updateMany).toHaveBeenLastCalledWith({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
    expect(mail.sendReset).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { usedAt: now },
    { expiresAt: now },
    { expiresAt: new Date(0) },
  ])(
    'rejects absent, used or expired links without hashing a password',
    async (change) => {
      if (change === null)
        db.passwordResetToken.findUnique.mockResolvedValue(null);
      else
        db.passwordResetToken.findUnique.mockResolvedValue({
          id: 'reset-id',
          userId,
          authVersion: 3,
          usedAt: null,
          expiresAt: new Date(now.getTime() + 900_000),
          ...change,
        });
      await expect(
        service.reset({ token: rawToken, password }),
      ).rejects.toMatchObject({
        status: 400,
        message:
          'Link de recuperação inválido ou expirado. Solicite um novo link.',
      });
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rechecks expiry after slow password hashing', async () => {
    passwords.hash.mockImplementation(() => {
      vi.setSystemTime(new Date(now.getTime() + 900_001));
      return Promise.resolve('hash');
    });
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.reset({ token: rawToken, password }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      db.passwordResetToken.updateMany.mock.calls[0][0].where.expiresAt.gt.getTime(),
    ).toBe(now.getTime() + 900_001);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('allows only one winner when the same token is claimed concurrently', async () => {
    let claimed = false;
    db.passwordResetToken.updateMany.mockImplementation((input) => {
      if (!input.where.id) return Promise.resolve({ count: 1 });
      if (claimed) return Promise.resolve({ count: 0 });
      claimed = true;
      return Promise.resolve({ count: 1 });
    });
    const results = await Promise.allSettled([
      service.reset({ token: rawToken, password }),
      service.reset({ token: rawToken, password }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(db.user.updateMany).toHaveBeenCalledTimes(1);
    expect(db.refreshToken.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a link issued for an older credential version', async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.reset({ token: rawToken, password }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(['passwordResetToken', 'user', 'refreshToken'] as const)(
    'aborts the transaction on %s write failure and sanitizes the error',
    async (model) => {
      db[model].updateMany.mockRejectedValue(
        new Error('private failed statement'),
      );
      await expect(
        service.reset({ token: rawToken, password }),
      ).rejects.toMatchObject({
        status: 503,
        message: 'Recuperação de senha temporariamente indisponível.',
      });
    },
  );

  it('does not query the database for malformed tokens', async () => {
    await expect(
      service.reset({ token: 'invalid', password }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});
