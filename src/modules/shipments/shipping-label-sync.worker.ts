import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { MelhorEnvioLabelsService } from './integrations/melhor-envio-labels.service.js';
import { ShippingLabelsService } from './shipping-labels.service.js';

@Injectable()
export class ShippingLabelSyncWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private cursor?: string;
  private stopping = false;
  private readonly logger = new Logger(ShippingLabelSyncWorker.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MelhorEnvioLabelsService)
    private readonly provider: MelhorEnvioLabelsService,
    @Inject(ShippingLabelsService)
    private readonly labels: ShippingLabelsService,
  ) {}
  onModuleInit() {
    if (process.env.SHIPPING_LABEL_SYNC_ENABLED === 'false') return;
    const seconds = Number(
      process.env.SHIPPING_LABEL_SYNC_INTERVAL_SECONDS ?? '60',
    );
    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
      throw new Error(
        'SHIPPING_LABEL_SYNC_INTERVAL_SECONDS deve ser inteiro entre 30 e 3600.',
      );
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, seconds * 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  async tick() {
    if (
      this.stopping ||
      this.running ||
      process.env.SHIPPING_LABEL_SYNC_ENABLED === 'false' ||
      !process.env.MELHOR_ENVIO_TOKEN?.trim()
    )
      return;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  private async run() {
    try {
      this.provider.assertConfigured();
      const candidates = await this.prisma.shipmentLabel.findMany({
        where: {
          provider: this.provider.provider,
          remoteId: { not: null },
          status: {
            notIn: [
              'DELIVERED',
              'REVIEW_REQUIRED',
              'CANCELED',
              'EXPIRED',
              'SUSPENDED',
            ],
          },
          shipment: {
            status: { in: ['PREPARING', 'READY_TO_SHIP', 'SHIPPED'] },
          },
          ...(this.cursor ? { id: { gt: this.cursor } } : {}),
        },
        select: { id: true, shipmentId: true },
        orderBy: { id: 'asc' },
        take: 20,
      });
      for (const candidate of candidates) {
        if (this.stopping) break;
        try {
          await this.labels.sync(candidate.shipmentId);
        } catch {
          this.logger.warn(
            `Sincronização pendente para o envio ${candidate.shipmentId}. Nova consulta no próximo ciclo do lote.`,
          );
        }
      }
      this.cursor =
        candidates.length === 20 ? candidates.at(-1)?.id : undefined;
    } catch {
      this.logger.error(
        'Não foi possível consultar etiquetas para sincronização.',
      );
    }
  }
}
