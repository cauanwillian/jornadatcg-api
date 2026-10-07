import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { AsaasPixService } from './asaas-pix.service.js';
import { AsaasService } from './integrations/asaas.service.js';
import {
  AsaasWebhookController,
  AsaasWebhookGuard,
} from './asaas-webhook.controller.js';
import { AsaasReconciliationWorker } from './asaas-reconciliation.worker.js';
import { CreatePixPipe } from './dto/create-pix.dto.js';
import { OrderReservationConfig } from '../orders/order-reservation.config.js';
import { ShipmentPaymentsController } from './shipment-payments.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    PaymentsController,
    AsaasWebhookController,
    ShipmentPaymentsController,
  ],
  providers: [
    PaymentsService,
    AsaasPixService,
    AsaasService,
    AsaasWebhookGuard,
    AsaasReconciliationWorker,
    CreatePixPipe,
    OrderReservationConfig,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
