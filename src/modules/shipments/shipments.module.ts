import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { AvailableItemsPipe } from './dto/available-items.dto.js';
import { ShipmentRequestsService } from './shipment-requests.service.js';
import {
  CreateShipmentPipe,
  ShipmentKeyPipe,
} from './dto/create-shipment.dto.js';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ShipmentsController],
  providers: [
    ShipmentsService,
    AvailableItemsPipe,
    ShipmentRequestsService,
    CreateShipmentPipe,
    ShipmentKeyPipe,
  ],
})
export class ShipmentsModule {}
