import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PasswordRecoveryService } from './password-recovery.service.js';
import {
  ForgotPasswordBodyPipe,
  ResetPasswordBodyPipe,
} from './dto/password-recovery.dto.js';
import type {
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password-recovery.dto.js';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class PasswordRecoveryController {
  constructor(
    @Inject(PasswordRecoveryService)
    private readonly recovery: PasswordRecoveryService,
  ) {}

  @Post('forgot-password')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgot(@Body(ForgotPasswordBodyPipe) input: ForgotPasswordDto) {
    return this.recovery.request(input);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reset(@Body(ResetPasswordBodyPipe) input: ResetPasswordDto) {
    return this.recovery.reset(input);
  }
}
