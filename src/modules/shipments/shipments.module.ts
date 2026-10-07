import { Module } from '@nestjs/common';
import { ShippingLabelSyncWorker } from './shipping-label-sync.worker.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { AvailableItemsPipe } from './dto/available-items.dto.js';
import { ShipmentRequestsService } from './shipment-requests.service.js';
import { ShippingQuotesController } from './shipping-quotes.controller.js';
import { ShippingQuotesService } from './shipping-quotes.service.js';
import { ShippingProvidersService } from './integrations/shipping-providers.service.js';
import { AdminShipmentsController } from './admin-shipments.controller.js';
import { ShippingLabelsService } from './shipping-labels.service.js';
import { MelhorEnvioLabelsService } from './integrations/melhor-envio-labels.service.js';
import {
  CreateLabelPipe,
  LabelCheckoutPipe,
} from './dto/shipping-label.dto.js';
import {
  CreateShipmentPipe,
  ShipmentKeyPipe,
} from './dto/create-shipment.dto.js';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    ShipmentsController,
    ShippingQuotesController,
    AdminShipmentsController,
  ],
  providers: [
    ShippingLabelSyncWorker,
    ShippingLabelsService,
    MelhorEnvioLabelsService,
    CreateLabelPipe,
    LabelCheckoutPipe,
    ShippingQuotesService,
    ShippingProvidersService,
    ShipmentsService,
    AvailableItemsPipe,
    ShipmentRequestsService,
    CreateShipmentPipe,
    ShipmentKeyPipe,
  ],
})
export class ShipmentsModule {}
