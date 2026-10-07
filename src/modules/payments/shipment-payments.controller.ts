import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AsaasPixService } from './asaas-pix.service.js';
import { CreatePixPipe } from './dto/create-pix.dto.js';
import type { CreatePixDto } from './dto/create-pix.dto.js';

@Controller('shipments/:id/payments/pix')
@UseGuards(JwtAuthGuard)
export class ShipmentPaymentsController {
  constructor(@Inject(AsaasPixService) private readonly pix: AsaasPixService) {}
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(CreatePixPipe) body: CreatePixDto,
  ) {
    return this.pix.createShipment(req.user.id, id, body);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pix.getShipment(req.user.id, id);
  }
}
