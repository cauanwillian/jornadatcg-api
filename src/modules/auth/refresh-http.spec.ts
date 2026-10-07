import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from './auth.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthService } from './auth.service.js';
import { RefreshSessionService } from './refresh-session.service.js';

describe('Session cookie HTTP endpoints', () => {
  let app: INestApplication;
  const secret = 'r'.repeat(64);
  const auth = { login: vi.fn() };
  const sessions = {
    issue: vi.fn(),
    rotate: vi.fn(),
    logout: vi.fn(),
    maxAge: 2592000000,
  };
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_ALLOWED_ORIGINS', 'http://localhost:5173');
    auth.login.mockResolvedValue({
      accessToken: 'access',
      expiresIn: 900,
      user: { id: 'user' },
    });
    sessions.issue.mockResolvedValue(secret);
    sessions.rotate.mockResolvedValue({
      body: { accessToken: 'new-access', expiresIn: 900 },
      token: 's'.repeat(64),
      maxAge: 60000,
    });
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(RefreshSessionService)
      .useValue(sessions)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
  it('sets HttpOnly cookie on login without returning refresh token in JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });
  it('rotates via cookie even without a Bearer token', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `jornada_refresh=${secret}`)
      .set('X-Requested-With', 'JornadaTCG')
      .expect(200);
    expect(sessions.rotate).toHaveBeenCalledWith(secret);
    expect(response.body.accessToken).toBe('new-access');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie'][0]).toContain('jornada_refresh=');
  });
  it('blocks cross-origin login and refresh without CSRF header', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://evil.test')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(403);
    await request(app.getHttpServer()).post('/auth/refresh').expect(403);
    expect(auth.login).not.toHaveBeenCalled();
    expect(sessions.rotate).not.toHaveBeenCalled();
  });
  it('revokes the session and expires the cookie on logout', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `jornada_refresh=${secret}`)
      .set('X-Requested-With', 'JornadaTCG')
      .expect(204);
    expect(sessions.logout).toHaveBeenCalledWith(secret);
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=0');
  });
});
