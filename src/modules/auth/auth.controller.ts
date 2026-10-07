import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginBodyPipe, RegisterBodyPipe } from './dto/auth.dto.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from './auth.types.js';
import type { Request, Response } from 'express';
import { RefreshSessionService } from './refresh-session.service.js';
import {
  checkSessionOrigin,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RefreshSessionService)
    private readonly sessions: RefreshSessionService,
  ) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body(RegisterBodyPipe) body: RegisterDto) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(LoginBodyPipe) body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkSessionOrigin(req);
    const result = await this.auth.login(body);
    const token = await this.sessions.issue(result.user.id);
    setRefreshCookie(res, token, this.sessions.maxAge);
    return result;
  }

  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkSessionOrigin(req, true);
    const result = await this.sessions.rotate(readRefreshCookie(req));
    setRefreshCookie(res, result.token, result.maxAge);
    return result.body;
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    checkSessionOrigin(req, true);
    await this.sessions.logout(readRefreshCookie(req));
    setRefreshCookie(res, '', 0);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }
}
