import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OrderExpirationService } from './order-expiration.service.js';

@Injectable()
export class OrderExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpirationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    @Inject(OrderExpirationService)
    private readonly expiration: OrderExpirationService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    this.timer.unref();
  }

  async tick() {
    if (this.running) return this.running;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  private async run() {
    try {
      const result = await this.expiration.expireBatch();
      if (result.failed)
        this.logger.warn(
          `Falha ao expirar ${result.failed} pedido(s); nova tentativa no próximo ciclo.`,
        );
    } catch {
      this.logger.error('Não foi possível consultar pedidos para expiração.');
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
