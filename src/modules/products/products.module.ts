import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { AdminInventoryController } from './admin-inventory.controller.js';
import { AdminInventoryService } from './admin-inventory.service.js';
import { AdminInventoryPipe } from './dto/admin-inventory.dto.js';
import { StockMovementsController } from '../inventory/stock-movements.controller.js';
import { StockMovementsService } from '../inventory/stock-movements.service.js';
import { StockMovementsPipe } from '../inventory/dto/stock-movements.dto.js';
import { StockEntriesController } from '../inventory/stock-entries.controller.js';
import { StockEntriesService } from '../inventory/stock-entries.service.js';
import { StockEntryPipe } from '../inventory/dto/stock-entry.dto.js';
import {
  CreateProductPipe,
  UpdateProductPipe,
  InventoryPipe,
  ListProductsPipe,
} from './dto/products.dto.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    ProductsController,
    AdminInventoryController,
    StockMovementsController,
    StockEntriesController,
  ],
  providers: [
    ProductsService,
    AdminInventoryService,
    AdminInventoryPipe,
    StockMovementsService,
    StockMovementsPipe,
    StockEntriesService,
    StockEntryPipe,
    CreateProductPipe,
    UpdateProductPipe,
    InventoryPipe,
    ListProductsPipe,
  ],
})
export class ProductsModule {}
