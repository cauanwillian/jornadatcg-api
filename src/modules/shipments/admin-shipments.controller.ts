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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ShippingLabelsService } from './shipping-labels.service.js';
import {
  CreateLabelPipe,
  LabelCheckoutPipe,
} from './dto/shipping-label.dto.js';
import type { CreateLabelInput } from './dto/shipping-label.dto.js';
import { AvailableItemsPipe } from './dto/available-items.dto.js';
import type { AvailableItemsQuery } from './dto/available-items.dto.js';

@Controller('admin/shipments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminShipmentsController {
  constructor(
    @Inject(ShippingLabelsService)
    private readonly labels: ShippingLabelsService,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query(AvailableItemsPipe) query: AvailableItemsQuery) {
    return this.labels.list(query);
  }
  @Post(':id/pack')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  pack(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.labels.pack(id, req.user.id);
  }
  @Post(':id/label')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  create(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body(CreateLabelPipe) body: CreateLabelInput,
  ) {
    return this.labels.create(id, req.user.id, body);
  }
  @Post(':id/label/recover/:remoteId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  recover(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('remoteId', new ParseUUIDPipe()) remoteId: string,
  ) {
    return this.labels.recover(id, remoteId);
  }
  @Post(':id/label/checkout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  checkout(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(LabelCheckoutPipe) body: { expectedCost: string },
  ) {
    return this.labels.checkout(id, body.expectedCost);
  }
  @Post(':id/label/generate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  generate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.labels.generate(id);
  }
  @Post(':id/label/sync')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  sync(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.labels.sync(id);
  }
  @Get(':id/label/print')
  @Header('Cache-Control', 'no-store')
  print(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.labels.print(id);
  }
}
