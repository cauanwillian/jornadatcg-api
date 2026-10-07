import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { Header, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ShippingEstimateService,
  EstimateQueryPipe,
} from './shipping-estimate.service.js';
import type { EstimateQuery } from './shipping-estimate.service.js';
import { CatalogQueryPipe } from './catalog-query.js';
import type { CatalogQuery } from './catalog-query.js';
@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ShippingEstimateService)
    private readonly estimates: ShippingEstimateService,
  ) {}
  @Get('products') list(@Query(CatalogQueryPipe) query: CatalogQuery) {
    return this.catalog.list(query);
  }
  @Get('products/:id') find(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.find(id);
  }
  @Get('filters') filters() {
    return this.catalog.filters();
  }
  @Get('featured')
  @Header('Cache-Control', 'no-store')
  featured() {
    return this.catalog.featured();
  }
  @Get('products/:id/shipping-estimate')
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  estimate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(EstimateQueryPipe) query: EstimateQuery,
  ) {
    return this.estimates.estimate(id, query);
  }
}
