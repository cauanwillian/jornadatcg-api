import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { AdminOrderListPipe } from './dto/admin-order-input.dto.js';
import type { AdminOrderListQuery } from './dto/admin-order-input.dto.js';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminOrdersController {
  constructor(
    @Inject(AdminOrdersService) private readonly orders: AdminOrdersService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query(AdminOrderListPipe) query: AdminOrderListQuery) {
    return this.orders.list(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.detail(id);
  }
}
