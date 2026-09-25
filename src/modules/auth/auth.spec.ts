import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import type { App } from 'supertest/types';
import request from 'supertest';
import { AuthModule } from './auth.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { publicUserSelect } from './auth.types.js';

const secret = 'test-only-jwt-secret-with-at-least-32-bytes';
const user = {
  id: 'a99d3fe9-a5fb-4f35-9218-88592106d61f',
  name: 'Test User',
  email: 'test@example.com',
  role: 'CUSTOMER',
};
const registration = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'a secure test password',
};
const jwt = new JwtService();
function token(
  options: JwtSignOptions = {},
  claims: Record<string, unknown> = {},
): string {
  return jwt.sign(claims, {
    secret,
    algorithm: 'HS256',
    subject: user.id,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
    ...options,
  });
}

describe('Authentication HTTP', () => {
  let app: INestApplication<App>;
  const db = { user: { create: vi.fn(), findUnique: vi.fn() } };
  const passwords = { hash: vi.fn(), verify: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    db.user.create.mockResolvedValue(user);
    db.user.findUnique.mockResolvedValue({
      ...user,
      passwordHash: 'stored-hash',
    });
    passwords.hash.mockResolvedValue('stored-hash');
    passwords.verify.mockResolvedValue(true);
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(PasswordService)
      .useValue(passwords)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('registers a customer with normalized email and hashed password', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        ...registration,
        email: ' Test@Example.COM ',
        name: ' Test User ',
      })
      .expect(201);
    expect(db.user.create).toHaveBeenCalledWith({
      data: {
        name: user.name,
        email: user.email,
        passwordHash: 'stored-hash',
        role: 'CUSTOMER',
      },
      select: publicUserSelect,
    });
    expect(passwords.hash).toHaveBeenCalledWith(registration.password);
    expect(response.body).toEqual(user);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([
    { ...registration, role: 'ADMIN' },
    { ...registration, passwordHash: 'forged' },
    { ...registration, password: 'short' },
    { ...registration, password: 'x'.repeat(129) },
    { ...registration, name: ' ' },
    { ...registration, email: 'invalid' },
    { ...registration, email: ['test@example.com'] },
    {},
    [],
  ])('rejects invalid or privileged registration fields %j', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(400);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
  });

  it('handles duplicate emails without exposing database details', async () => {
    db.user.create.mockRejectedValue({
      code: 'P2002',
      message: 'private database details',
    });
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registration)
      .expect(409);
    expect(response.text).not.toContain('private');
  });

  it('returns a verifiable 15-minute token and no password hash at login', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ' TEST@EXAMPLE.COM ', password: registration.password })
      .expect(200);
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: user.email },
      select: { ...publicUserSelect, passwordHash: true },
    });
    expect(response.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user,
    });
    expect(response.text).not.toContain('stored-hash');
    const payload = jwt.verify<Record<string, unknown>>(
      response.body.accessToken,
      {
        secret,
        algorithms: ['HS256'],
        issuer: 'jornadatcg-api',
        audience: 'jornadatcg',
      },
    );
    expect(payload.sub).toBe(user.id);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
    expect(payload).not.toHaveProperty('role');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('uses the same 401 response for missing user and wrong password', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    const first = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: registration.password })
      .expect(401);
    expect(passwords.verify).toHaveBeenCalledWith(
      registration.password,
      undefined,
    );
    passwords.verify.mockResolvedValue(false);
    const second = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: registration.password })
      .expect(401);
    expect(first.body).toEqual(second.body);
  });

  it.each([
    {},
    { email: 'invalid', password: 'valid' },
    { email: user.email, password: '' },
    { email: user.email, password: 123 },
    { email: user.email, password: 'valid', role: 'ADMIN' },
  ])('validates login input %j', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(400);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns the current database profile, ignoring role claims in the token', async () => {
    db.user.findUnique.mockResolvedValue(user);
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token({}, { role: 'ADMIN' })}`)
      .expect(200);
    expect(response.body).toEqual(user);
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: publicUserSelect,
    });
  });

  it.each([undefined, 'Basic abc', 'Bearer invalid', 'Bearer token extra'])(
    'rejects invalid authorization headers %s',
    async (authorization) => {
      const req = request(app.getHttpServer()).get('/auth/me');
      if (authorization) req.set('Authorization', authorization);
      await req.expect(401);
      expect(db.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    { secret: 'a-different-secret-with-at-least-32-bytes' },
    { issuer: 'another-issuer' },
    { audience: 'another-audience' },
    { expiresIn: -1 },
    { expiresIn: 3600 },
    { algorithm: 'HS384' },
    { subject: 'not-a-uuid' },
  ] satisfies JwtSignOptions[])(
    'rejects invalid JWT signature or claims %j',
    async (options) => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token(options)}`)
        .expect(401);
      expect(db.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects a token missing expiration', async () => {
    const value = jwt.sign(
      { sub: user.id },
      { secret, issuer: 'jornadatcg-api', audience: 'jornadatcg' },
    );
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${value}`)
      .expect(401);
  });

  it('rejects a token belonging to a deleted user', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token()}`)
      .expect(401);
  });

  it.each(['', 'short'])(
    'disables auth with invalid secret configuration',
    async (configured) => {
      vi.stubEnv('JWT_SECRET', configured);
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registration)
        .expect(503);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: registration.password })
        .expect(503);
      expect(db.user.create).not.toHaveBeenCalled();
      expect(db.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('sanitizes database failures', async () => {
    db.user.create.mockRejectedValue(new Error('private connection URL'));
    db.user.findUnique.mockRejectedValue(new Error('private connection URL'));
    for (const path of ['/auth/register', '/auth/login']) {
      const body = path.endsWith('register')
        ? registration
        : { email: user.email, password: registration.password };
      const response = await request(app.getHttpServer())
        .post(path)
        .send(body)
        .expect(503);
      expect(response.text).not.toContain('private');
    }
  });

  it('rate limits login requests before further password work', async () => {
    passwords.verify.mockResolvedValue(false);
    for (let index = 0; index < 10; index++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: registration.password })
        .expect(401);
    }
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: registration.password })
      .expect(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(passwords.verify).toHaveBeenCalledTimes(10);
  });

  it('rate limits registrations before further database writes', async () => {
    for (let index = 0; index < 5; index++) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registration)
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registration)
      .expect(429);
    expect(db.user.create).toHaveBeenCalledTimes(5);
  });
});
