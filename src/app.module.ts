import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CardsModule } from './modules/cards/cards.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { AddressesModule } from './modules/addresses/addresses.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CardsModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    AddressesModule,
    ShipmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
