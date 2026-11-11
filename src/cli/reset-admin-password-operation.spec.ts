import type { PrismaService } from '../database/prisma.service.js';
import type { PasswordService } from '../modules/auth/password.service.js';
import { resetAdminPassword } from './reset-admin-password-operation.js';

const userId = '11111111-1111-4111-8111-111111111111';
const email = 'admin@example.com';
const password = 'fixture-password-only';
function setup() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: userId, role: 'ADMIN' }),
    },
    $transaction: vi.fn().mockImplementation((work) => work(tx)),
  };
  const passwords = { hash: vi.fn().mockResolvedValue('hashed-fixture') };
  const run = (value = password, account = email) =>
    resetAdminPassword(
      db as unknown as PrismaService,
      passwords as unknown as PasswordService,
      account,
      value,
    );
  return { tx, db, passwords, run };
}
beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
afterEach(() => vi.unstubAllEnvs());

it('updates only the chosen administrator and invalidates all existing sessions and recovery links atomically', async () => {
  const f = setup();
  await f.run();
  expect(f.db.user.findUnique).toHaveBeenCalledWith({
    where: { email },
    select: { id: true, role: true },
  });
  expect(f.passwords.hash).toHaveBeenCalledWith(password);
  expect(f.tx.user.updateMany).toHaveBeenCalledWith({
    where: { id: userId, email, role: 'ADMIN' },
    data: { passwordHash: 'hashed-fixture', authVersion: { increment: 1 } },
  });
  expect(f.tx.refreshToken.updateMany).toHaveBeenCalledWith({
    where: { userId, revokedAt: null },
    data: { revokedAt: expect.any(Date) },
  });
  expect(f.tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
    where: { userId, usedAt: null },
    data: { usedAt: expect.any(Date) },
  });
  expect(f.tx.$queryRaw).toHaveBeenCalledOnce();
  expect(f.tx.$queryRaw.mock.calls[0][1]).toBe(userId);
  expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
    f.tx.user.updateMany.mock.invocationCallOrder[0],
  );
  expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
    maxWait: 5000,
    timeout: 5000,
  });
  expect(f.passwords.hash.mock.invocationCallOrder[0]).toBeLessThan(
    f.db.$transaction.mock.invocationCallOrder[0],
  );
});
it('blocks production before hashing or database access', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const f = setup();
  await expect(f.run()).rejects.toThrow('não está disponível em produção');
  expect(f.db.user.findUnique).not.toHaveBeenCalled();
  expect(f.passwords.hash).not.toHaveBeenCalled();
});
it.each(['', 'short', ' '.repeat(12), 'a'.repeat(129)])(
  'rejects invalid passwords before database access',
  async (value) => {
    const f = setup();
    await expect(f.run(value)).rejects.toThrow('12 a 128');
    expect(f.db.user.findUnique).not.toHaveBeenCalled();
  },
);
it('rejects invalid email and normalizes a valid email without changing the password', async () => {
  const f = setup();
  await expect(f.run(password, 'invalid')).rejects.toThrow('e-mail válido');
  expect(f.db.user.findUnique).not.toHaveBeenCalled();
  await f.run('  valid password  ', ' ADMIN@EXAMPLE.COM ');
  expect(f.passwords.hash).toHaveBeenCalledWith('  valid password  ');
  expect(f.db.user.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { email } }),
  );
});
it.each([null, { id: userId, role: 'CUSTOMER' }])(
  'never creates or promotes accounts',
  async (user) => {
    const f = setup();
    f.db.user.findUnique.mockResolvedValue(user);
    await expect(f.run()).rejects.toThrow('Confira a conta administrativa');
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.passwords.hash).not.toHaveBeenCalled();
  },
);
it('rechecks the administrator role and email inside the locked transaction', async () => {
  const f = setup();
  f.tx.user.updateMany.mockResolvedValue({ count: 0 });
  await expect(f.run()).rejects.toThrow('Confira a conta administrativa');
  expect(f.tx.refreshToken.updateMany).not.toHaveBeenCalled();
  expect(f.tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
});
it('rolls back the password and session changes if invalidating recovery links fails', async () => {
  const f = setup();
  const state = { password: 'original', version: 0, revoked: false };
  f.tx.user.updateMany.mockImplementation(async () => {
    state.password = 'changed';
    state.version++;
    return { count: 1 };
  });
  f.tx.refreshToken.updateMany.mockImplementation(async () => {
    state.revoked = true;
    return { count: 1 };
  });
  f.tx.passwordResetToken.updateMany.mockRejectedValue(
    new Error('private database password'),
  );
  f.db.$transaction.mockImplementation(async (work) => {
    const before = { ...state };
    try {
      return await work(f.tx);
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  });
  await expect(f.run()).rejects.toThrow('Confira a conta administrativa');
  expect(state).toEqual({ password: 'original', version: 0, revoked: false });
});
it('does not expose hash, password or connection errors', async () => {
  const f = setup();
  f.passwords.hash.mockRejectedValue(
    new Error(password + ' private database url'),
  );
  await expect(f.run()).rejects.toThrow('Não foi possível redefinir');
  expect(f.db.$transaction).not.toHaveBeenCalled();
});
