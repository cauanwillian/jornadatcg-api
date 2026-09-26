import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UseGuards,
  Body,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ShipmentsService } from './shipments.service.js';
import { AvailableItemsPipe } from './dto/available-items.dto.js';
import type { AvailableItemsQuery } from './dto/available-items.dto.js';
import { ShipmentRequestsService } from './shipment-requests.service.js';
import {
  CreateShipmentPipe,
  ShipmentKeyPipe,
} from './dto/create-shipment.dto.js';
import type { CreateShipmentInput } from './dto/create-shipment.dto.js';
@Controller('shipments')
@UseGuards(JwtAuthGuard)
export class ShipmentsController {
  constructor(
    @Inject(ShipmentsService) private readonly shipments: ShipmentsService,
    @Inject(ShipmentRequestsService)
    private readonly requests: ShipmentRequestsService,
  ) {}
  @Get('available-items')
  @Header('Cache-Control', 'no-store')
  available(
    @Req() req: AuthenticatedRequest,
    @Query(AvailableItemsPipe) query: AvailableItemsQuery,
  ) {
    return this.shipments.availableItems(req.user.id, query);
  }
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body(CreateShipmentPipe) body: CreateShipmentInput,
  ) {
    return this.requests.create(
      req.user.id,
      new ShipmentKeyPipe().transform(key),
      body,
    );
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Query(AvailableItemsPipe) query: AvailableItemsQuery,
  ) {
    return this.requests.list(req.user.id, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.requests.get(req.user.id, id);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.requests.cancel(req.user.id, id);
  }
}
