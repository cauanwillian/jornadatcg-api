import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import {
  CreateProductPipe,
  UpdateProductPipe,
  InventoryPipe,
  ListProductsPipe,
} from './dto/products.dto.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    CreateProductPipe,
    UpdateProductPipe,
    InventoryPipe,
    ListProductsPipe,
  ],
})
export class ProductsModule {}
