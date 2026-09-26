import {
  Controller,
  Body,
  Post,
  HttpCode,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { PaymentsService } from './payments.service.js';
import { AsaasPixService } from './asaas-pix.service.js';
import { CreatePixPipe } from './dto/create-pix.dto.js';
import type { CreatePixDto } from './dto/create-pix.dto.js';

@Controller('orders/:orderId/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(AsaasPixService) private readonly pix: AsaasPixService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ) {
    return this.payments.list(request.user.id, orderId);
  }

  @Post('pix')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  createPix(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body(CreatePixPipe) body: CreatePixDto,
  ) {
    return this.pix.create(request.user.id, orderId, body);
  }

  @Get('pix')
  @Header('Cache-Control', 'no-store')
  getPix(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ) {
    return this.pix.get(request.user.id, orderId);
  }
}
