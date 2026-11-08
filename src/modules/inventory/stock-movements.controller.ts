import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { StockMovementsPipe } from './dto/stock-movements.dto.js';
import type { StockMovementsQuery } from './dto/stock-movements.dto.js';
import { StockMovementsService } from './stock-movements.service.js';

@Controller('admin/inventory/movements')
@UseGuards(JwtAuthGuard, AdminGuard)
export class StockMovementsController {
  constructor(
    @Inject(StockMovementsService)
    private readonly movements: StockMovementsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query(StockMovementsPipe) query: StockMovementsQuery) {
    return this.movements.list(query);
  }
}
