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
import { AdminInventoryService } from './admin-inventory.service.js';
import { AdminInventoryPipe } from './dto/admin-inventory.dto.js';
import type { AdminInventoryQuery } from './dto/admin-inventory.dto.js';

@Controller('admin/inventory')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminInventoryController {
  constructor(
    @Inject(AdminInventoryService)
    private readonly inventory: AdminInventoryService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query(AdminInventoryPipe) query: AdminInventoryQuery) {
    return this.inventory.list(query);
  }
}
