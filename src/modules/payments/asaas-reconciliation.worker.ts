import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AsaasService } from './integrations/asaas.service.js';
import { AsaasPixService } from './asaas-pix.service.js';

@Injectable()
export class AsaasReconciliationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private cursor?: string;
  private readonly logger = new Logger(AsaasReconciliationWorker.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AsaasService) private readonly asaas: AsaasService,
    @Inject(AsaasPixService) private readonly pix: AsaasPixService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  async tick() {
    if (this.running || !process.env.ASAAS_API_KEY?.trim()) return;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  private async run() {
    try {
      const candidates = await this.prisma.payment.findMany({
        where: {
          provider: this.asaas.provider,
          status: 'PENDING',
          ...(this.cursor ? { id: { gt: this.cursor } } : {}),
          OR: [
            { updatedAt: { lte: new Date(Date.now() - 120_000) } },
            { expiresAt: { lte: new Date() } },
          ],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 20,
      });
      for (const { id } of candidates) {
        try {
          await this.pix.reconcileOne(id);
        } catch {
          this.logger.warn(
            `Reconciliação pendente para o pagamento ${id}. Verifique a cobrança no Asaas.`,
          );
        }
      }
      this.cursor =
        candidates.length === 20 ? candidates.at(-1)?.id : undefined;
    } catch {
      this.logger.error(
        'Não foi possível consultar pagamentos para reconciliação.',
      );
    }
  }
}
