import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ShippingProvidersService } from '../shipments/integrations/shipping-providers.service.js';
import {
  ShippingEstimateService,
  EstimateQueryPipe,
} from './shipping-estimate.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogQueryPipe } from './catalog-query.js';
@Module({
  imports: [
    DatabaseModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
  ],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogQueryPipe,
    ShippingProvidersService,
    ShippingEstimateService,
    EstimateQueryPipe,
    ThrottlerGuard,
  ],
})
export class CatalogModule {}
