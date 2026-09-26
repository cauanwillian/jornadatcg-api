import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Injectable,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AsaasPixService } from './asaas-pix.service.js';
import { isRecord } from './integrations/asaas.service.js';

@Injectable()
export class AsaasWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const secret = process.env.ASAAS_WEBHOOK_TOKEN;
    if (
      !secret ||
      secret.length < 32 ||
      secret.length > 255 ||
      /\s/.test(secret) ||
      secret === process.env.ASAAS_API_KEY
    )
      throw new ServiceUnavailableException('Webhook Asaas não configurado.');
    const token = context.switchToHttp().getRequest<Request>().headers[
      'asaas-access-token'
    ];
    if (
      typeof token !== 'string' ||
      Buffer.byteLength(token) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(secret))
    )
      throw new UnauthorizedException('Token de webhook inválido.');
    return true;
  }
}

@Controller('webhooks/asaas')
@UseGuards(AsaasWebhookGuard)
export class AsaasWebhookController {
  constructor(@Inject(AsaasPixService) private readonly pix: AsaasPixService) {}
  @Post()
  @HttpCode(200)
  receive(@Body() body: unknown) {
    if (!isRecord(body) || typeof body.event !== 'string')
      throw new BadRequestException('Evento inválido.');
    if (!body.event.startsWith('PAYMENT_')) return { received: true };
    if (
      !isRecord(body.payment) ||
      typeof body.payment.id !== 'string' ||
      !/^pay_[A-Za-z0-9_-]{1,96}$/.test(body.payment.id)
    )
      throw new BadRequestException('Identificador da cobrança inválido.');
    return this.pix.handleWebhook(body.payment.id);
  }
}
