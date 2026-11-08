import { Module } from '@nestjs/common';
import { RefreshSessionService } from './refresh-session.service.js';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { PasswordService } from './password.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AdminGuard } from './guards/admin.guard.js';
import { LoginBodyPipe, RegisterBodyPipe } from './dto/auth.dto.js';
import { PasswordRecoveryController } from './password-recovery.controller.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { PasswordResetEmailService } from './password-reset-email.service.js';
import {
  ForgotPasswordBodyPipe,
  ResetPasswordBodyPipe,
} from './dto/password-recovery.dto.js';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AuthController, PasswordRecoveryController],
  providers: [
    RefreshSessionService,
    AuthService,
    AuthTokenService,
    PasswordService,
    JwtAuthGuard,
    AdminGuard,
    ThrottlerGuard,
    LoginBodyPipe,
    RegisterBodyPipe,
    PasswordRecoveryService,
    PasswordResetEmailService,
    ForgotPasswordBodyPipe,
    ResetPasswordBodyPipe,
  ],
  exports: [JwtAuthGuard, AdminGuard, AuthService, AuthTokenService],
})
export class AuthModule {}
