import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { CheckoutPipe, OrderListPipe } from './dto/order-input.dto.js';
import { OrderReservationConfig } from './order-reservation.config.js';
import { OrderExpirationService } from './order-expiration.service.js';
import { OrderExpirationWorker } from './order-expiration.worker.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    CheckoutPipe,
    OrderListPipe,
    OrderReservationConfig,
    OrderExpirationService,
    OrderExpirationWorker,
  ],
})
export class OrdersModule {}
