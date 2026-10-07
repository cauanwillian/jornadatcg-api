import { RefreshSessionService } from './refresh-session.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuthTokenService } from './auth-token.service.js';
import {
  checkSessionOrigin,
  setRefreshCookie,
  readRefreshCookie,
} from './refresh-cookie.js';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';

describe('Refresh sessions', () => {
  const db = {
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  const tokens = { sign: vi.fn(), expiresIn: 900 };
  const token = 'a'.repeat(64);
  let service: RefreshSessionService;
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation((work) => work(db));
    db.refreshToken.findUnique.mockResolvedValue({
      id: 'id',
      userId: 'user',
      familyId: 'family',
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      revokedAt: null,
    });
    db.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.findUnique.mockResolvedValue({ id: 'user', role: 'CUSTOMER' });
    tokens.sign.mockResolvedValue('access');
    service = new RefreshSessionService(
      db as unknown as PrismaService,
      tokens as unknown as AuthTokenService,
    );
  });
  afterEach(() => vi.unstubAllEnvs());
  it('stores only a hash of an unpredictable token', async () => {
    const result = await service.issue('user');
    expect(result).toMatch(/^[\w-]{64}$/);
    expect(db.refreshToken.create.mock.calls[0][0].data.tokenHash).toBe(
      createHash('sha256').update(result).digest('hex'),
    );
    expect(JSON.stringify(db.refreshToken.create.mock.calls)).not.toContain(
      result,
    );
  });
  it('rotates atomically and preserves absolute expiration', async () => {
    const result = await service.rotate(token);
    expect(result.token).not.toBe(token);
    expect(result.body).toMatchObject({
      accessToken: 'access',
      expiresIn: 900,
    });
    expect(db.refreshToken.updateMany.mock.calls[0][0].where).toMatchObject({
      usedAt: null,
      revokedAt: null,
    });
    expect(db.refreshToken.create.mock.calls[0][0].data.familyId).toBe(
      'family',
    );
  });
  it('revokes the family when a token is reused or loses a concurrent rotation', async () => {
    db.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.rotate(token)).rejects.toMatchObject({ status: 401 });
    expect(db.refreshToken.create).not.toHaveBeenCalled();
    expect(db.refreshToken.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { familyId: 'family', revokedAt: null },
      }),
    );
  });
  it.each([undefined, 'invalid'])(
    'rejects missing or malformed token',
    async (value) => {
      await expect(service.rotate(value)).rejects.toMatchObject({
        status: 401,
      });
      expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
    },
  );
  it.each([{ expiresAt: new Date(0) }, { revokedAt: new Date() }])(
    'rejects expired or revoked sessions',
    async (change) => {
      db.refreshToken.findUnique.mockResolvedValue({
        expiresAt: new Date(Date.now() + 1000),
        ...change,
      });
      await expect(service.rotate(token)).rejects.toMatchObject({
        status: 401,
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('logout revokes the full session and accepts absent cookies', async () => {
    await service.logout();
    expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
    await service.logout(token);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId: 'family', revokedAt: null },
      }),
    );
  });
  it('sanitizes database failures', async () => {
    db.refreshToken.create.mockRejectedValue(new Error('secret'));
    await expect(service.issue('user')).rejects.toMatchObject({
      status: 503,
      message: 'Sessão temporariamente indisponível.',
    });
  });
  it('requires a custom header and validates browser origin', () => {
    vi.stubEnv('AUTH_ALLOWED_ORIGINS', 'http://localhost:5173');
    const req = (headers: Record<string, string>) => ({ headers }) as Request;
    expect(() => checkSessionOrigin(req({}), true)).toThrow();
    expect(() =>
      checkSessionOrigin(
        req({ 'x-requested-with': 'JornadaTCG', origin: 'https://evil.test' }),
        true,
      ),
    ).toThrow();
    expect(() =>
      checkSessionOrigin(
        req({
          'x-requested-with': 'JornadaTCG',
          origin: 'http://localhost:5173',
        }),
        true,
      ),
    ).not.toThrow();
  });
  it('uses restricted production cookies and rejects duplicate cookies', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const cookie = vi.fn();
    setRefreshCookie({ cookie } as unknown as Response, token, 1000);
    expect(cookie).toHaveBeenCalledWith(
      'jornada_refresh',
      token,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/auth',
      }),
    );
    expect(
      readRefreshCookie({
        headers: { cookie: 'jornada_refresh=a; jornada_refresh=b' },
      } as Request),
    ).toBeUndefined();
  });
});
