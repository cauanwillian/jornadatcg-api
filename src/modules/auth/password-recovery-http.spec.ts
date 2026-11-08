import type { INestApplication } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { PasswordRecoveryController } from './password-recovery.controller.js';
import {
  PasswordRecoveryService,
  recoveryAccepted,
  recoveryCompleted,
} from './password-recovery.service.js';
import {
  ForgotPasswordBodyPipe,
  ResetPasswordBodyPipe,
} from './dto/password-recovery.dto.js';

describe('Password recovery HTTP', () => {
  let app: INestApplication;
  const recovery = { request: vi.fn(), reset: vi.fn() };
  const token = 'A'.repeat(43);
  const password = '  a new password preserved exactly  ';
  beforeEach(async () => {
    vi.resetAllMocks();
    recovery.request.mockResolvedValue(recoveryAccepted);
    recovery.reset.mockResolvedValue(recoveryCompleted);
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60_000 }])],
      controllers: [PasswordRecoveryController],
      providers: [
        ThrottlerGuard,
        ForgotPasswordBodyPipe,
        ResetPasswordBodyPipe,
        { provide: PasswordRecoveryService, useValue: recovery },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('accepts normalized email without authentication or disclosure of account state', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: ' CUSTOMER@EXAMPLE.COM ' })
      .expect(202);
    expect(recovery.request).toHaveBeenCalledWith({
      email: 'customer@example.com',
    });
    expect(response.body).toEqual(recoveryAccepted);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    {},
    [],
    { email: '' },
    { email: 'bad' },
    { email: ['customer@example.com'] },
    { email: 'a'.repeat(255) },
    { email: 'customer@example.com', redirectUrl: 'https://attacker.example' },
    { email: 'customer@example.com', role: 'ADMIN' },
  ])('rejects invalid forgot-password data %j', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(body)
      .expect(400);
    expect(recovery.request).not.toHaveBeenCalled();
  });

  it('preserves the password and accepts only the recovery token and password', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password })
      .expect(200);
    expect(recovery.reset).toHaveBeenCalledWith({ token, password });
    expect(response.body).toEqual(recoveryCompleted);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).not.toHaveProperty('accessToken');
  });

  it.each([
    {},
    [],
    { token: 'invalid', password },
    { token: `${token}=`, password },
    { token, password: 'short' },
    { token, password: ' '.repeat(12) },
    { token, password: 'a'.repeat(129) },
    { token, password: [] },
    { token, password, email: 'customer@example.com' },
    { token, password, role: 'ADMIN' },
  ])('rejects invalid reset data %j', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send(body)
      .expect(400);
    expect(recovery.reset).not.toHaveBeenCalled();
  });

  it('limits recovery requests per IP and returns Retry-After', async () => {
    for (let index = 0; index < 5; index++)
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'customer@example.com' })
        .expect(202);
    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'customer@example.com' })
      .expect(429);
    expect(response.headers['retry-after']).toBeTruthy();
    expect(recovery.request).toHaveBeenCalledTimes(5);
  });

  it('limits attempts to redeem a token per IP', async () => {
    for (let index = 0; index < 10; index++)
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, password })
        .expect(200);
    const response = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password })
      .expect(429);
    expect(response.headers['retry-after']).toBeTruthy();
    expect(recovery.reset).toHaveBeenCalledTimes(10);
  });

  it('returns a service error when recovery delivery is not configured', async () => {
    recovery.request.mockRejectedValue(
      new ServiceUnavailableException('Recuperação de senha não configurada.'),
    );
    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'customer@example.com' })
      .expect(503);
    expect(response.body.message).toBe('Recuperação de senha não configurada.');
    expect(response.body).not.toHaveProperty('token');
  });
});
