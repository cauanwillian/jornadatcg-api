import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokenService,
    PasswordService,
    JwtAuthGuard,
    AdminGuard,
    ThrottlerGuard,
    LoginBodyPipe,
    RegisterBodyPipe,
  ],
  exports: [JwtAuthGuard, AdminGuard, AuthService, AuthTokenService],
})
export class AuthModule {}
