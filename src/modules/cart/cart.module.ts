import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';
import { SetCartItemPipe } from './dto/cart-item.dto.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CartController],
  providers: [CartService, SetCartItemPipe],
})
export class CartModule {}
