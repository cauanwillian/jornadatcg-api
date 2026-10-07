import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OrderReservationConfig } from '../orders/order-reservation.config.js';
import { PaymentsService } from './payments.service.js';
import {
  AsaasService,
  AsaasRejectedRequest,
} from './integrations/asaas.service.js';
import type { AsaasPayment } from './integrations/asaas.service.js';
import { paymentSelect, toPaymentDto } from './dto/payment-result.dto.js';
import type { CreatePixDto } from './dto/create-pix.dto.js';

const internalSelect = {
  ...paymentSelect,
  providerPaymentId: true,
  providerCustomerId: true,
  providerRequestStartedAt: true,
} satisfies Prisma.PaymentSelect;
type Intent = Prisma.PaymentGetPayload<{ select: typeof internalSelect }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AsaasPixService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AsaasService) private readonly asaas: AsaasService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(OrderReservationConfig)
    private readonly reservation: OrderReservationConfig,
  ) {}

  create(userId: string, orderId: string, body: CreatePixDto) {
    return this.protect(async () => {
      this.asaas.assertConfigured();
      const provider = this.asaas.provider;
      const intent = await this.transaction(async (tx) => {
        const order = await tx.order.findFirst({
          where: { id: orderId, userId },
          select: {
            id: true,
            status: true,
            total: true,
            expiresAt: true,
            user: { select: { id: true, name: true, email: true, cpf: true } },
          },
        });
        if (!order) throw new NotFoundException('Pedido não encontrado.');
        if (order.user.cpf && order.user.cpf !== body.cpf)
          throw new ConflictException(
            'CPF diferente do cadastro. Contate o suporte para corrigir.',
          );
        const existing = await tx.payment.findUnique({
          where: { orderId_provider: { orderId, provider } },
          select: internalSelect,
        });
        if (existing) return { payment: existing, user: order.user };
        if (
          order.status !== 'PENDING_PAYMENT' ||
          (order.expiresAt && order.expiresAt <= new Date())
        )
          throw new ConflictException(
            'Pedido encerrado ou com prazo de pagamento expirado.',
          );
        const other = await tx.payment.findFirst({
          where: { orderId, status: { in: ['PENDING', 'PAID', 'REFUNDED'] } },
          select: { id: true },
        });
        if (other)
          throw new ConflictException(
            'O pedido já possui uma cobrança em andamento.',
          );
        if (!order.user.cpf)
          await tx.user.update({
            where: { id: userId },
            data: { cpf: body.cpf },
            select: { id: true },
          });
        const expiresAt = order.expiresAt ?? this.reservation.deadline();
        await tx.order.update({
          where: { id: orderId },
          data: { expiresAt },
          select: { id: true },
        });
        const payment = await tx.payment.create({
          data: {
            orderId,
            provider,
            method: 'PIX',
            amount: order.total,
            expiresAt,
          },
          select: internalSelect,
        });
        return { payment, user: order.user };
      });
      return this.issue(intent, body);
    });
  }

  private async issue(
    intent: {
      payment: Intent;
      user: { id: string; name: string; email: string };
    },
    body: CreatePixDto,
  ) {
    const payment = intent.payment;
    if (payment.status !== 'PENDING') return this.presentation(payment);
    if (!payment.providerPaymentId && !payment.providerRequestStartedAt) {
      if (payment.expiresAt && payment.expiresAt <= new Date())
        throw new ConflictException('Prazo de pagamento expirado.');
      const customer =
        payment.providerCustomerId ??
        (await this.asaas.customer(intent.user, body.cpf));
      await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: 'PENDING',
          providerRequestStartedAt: null,
          providerCustomerId: null,
        },
        data: { providerCustomerId: customer },
      });
      // Commit the send marker before HTTP. Ambiguous failures may only recover
      // by externalReference, never by blindly issuing another payment POST.
      const claimed = await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: 'PENDING',
          providerRequestStartedAt: null,
          providerCustomerId: customer,
          expiresAt: { gt: new Date() },
        },
        data: { providerRequestStartedAt: new Date() },
      });
      if (claimed.count === 1) {
        let remote: AsaasPayment;
        try {
          remote = await this.asaas.createPix({
            customer,
            amount: payment.amount.toFixed(2),
            reference: payment.id,
            expiresAt: payment.expiresAt!,
            ...(payment.shipmentId ? { description: 'Frete JornadaTCG' } : {}),
          });
        } catch (error) {
          if (error instanceof AsaasRejectedRequest) {
            await this.prisma.payment.updateMany({
              where: {
                id: payment.id,
                providerPaymentId: null,
                status: 'PENDING',
              },
              data: { providerRequestStartedAt: null },
            });
          }
          throw error;
        }
        await this.acceptRemote(remote, payment.id);
      }
    }
    return this.presentation(await this.reconcileOne(payment.id));
  }

  get(userId: string, orderId: string) {
    return this.protect(async () => {
      this.asaas.assertConfigured();
      const payment = await this.prisma.payment.findFirst({
        where: { orderId, provider: this.asaas.provider, order: { userId } },
        select: { id: true },
      });
      if (!payment)
        throw new NotFoundException('Pagamento Pix não encontrado.');
      return this.presentation(await this.reconcileOne(payment.id));
    });
  }

  createShipment(userId: string, shipmentId: string, body: CreatePixDto) {
    return this.protect(async () => {
      this.asaas.assertConfigured();
      const provider = this.asaas.provider;
      const intent = await this.transaction(async (tx) => {
        const shipment = await tx.shipment.findFirst({
          where: { id: shipmentId, userId },
          include: {
            selectedQuote: true,
            user: { select: { id: true, name: true, email: true, cpf: true } },
            items: {
              select: {
                orderItem: {
                  select: {
                    order: {
                      select: {
                        status: true,
                        payments: { select: { status: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        if (!shipment) throw new NotFoundException('Envio não encontrado.');
        if (shipment.user.cpf && shipment.user.cpf !== body.cpf)
          throw new ConflictException(
            'CPF diferente do cadastro. Contate o suporte para corrigir.',
          );
        const existing = await tx.payment.findUnique({
          where: { shipmentId_provider: { shipmentId, provider } },
          select: internalSelect,
        });
        if (existing) return { payment: existing, user: shipment.user };
        const quote = shipment.selectedQuote;
        if (
          shipment.status !== 'PENDING' ||
          shipment.shippingPaidAt ||
          !quote ||
          quote.shipmentId !== shipmentId ||
          quote.expiresAt <= new Date() ||
          !quote.amount.equals(shipment.shippingCost)
        )
          throw new ConflictException(
            'Selecione uma cotação válida antes de pagar o frete.',
          );
        if (
          provider === 'asaas:production' &&
          quote.provider.endsWith(':sandbox')
        )
          throw new ConflictException(
            'Não é possível cobrar em produção uma cotação de teste.',
          );
        if (
          shipment.items.some(
            (item) =>
              ![
                'PAID',
                'PREPARING',
                'READY_TO_SHIP',
                'SHIPPED',
                'DELIVERED',
              ].includes(item.orderItem.order.status) ||
              !item.orderItem.order.payments.some((p) => p.status === 'PAID') ||
              item.orderItem.order.payments.some(
                (p) => p.status === 'REFUNDED',
              ),
          )
        )
          throw new ConflictException(
            'Compra vinculada ao envio exige revisão.',
          );
        if (
          await tx.payment.findFirst({
            where: { shipmentId },
            select: { id: true },
          })
        )
          throw new ConflictException(
            'Envio já possui cobrança em outro ambiente.',
          );
        if (!shipment.user.cpf)
          await tx.user.update({
            where: { id: userId },
            data: { cpf: body.cpf },
            select: { id: true },
          });
        const payment = await tx.payment.create({
          data: {
            shipmentId,
            provider,
            method: 'PIX',
            amount: quote.amount,
            expiresAt: quote.expiresAt,
          },
          select: internalSelect,
        });
        return { payment, user: shipment.user };
      });
      return this.issue(intent, body);
    });
  }

  getShipment(userId: string, shipmentId: string) {
    return this.protect(async () => {
      this.asaas.assertConfigured();
      const payment = await this.prisma.payment.findFirst({
        where: {
          shipmentId,
          provider: this.asaas.provider,
          shipment: { userId },
        },
        select: { id: true },
      });
      if (!payment)
        throw new NotFoundException('Pagamento do frete não encontrado.');
      return this.presentation(await this.reconcileOne(payment.id));
    });
  }

  handleWebhook(providerPaymentId: string) {
    return this.protect(async () => {
      await this.acceptRemote(await this.asaas.getPayment(providerPaymentId));
      return { received: true };
    });
  }

  reconcileOne(id: string): Promise<Intent> {
    return this.protect(async () => {
      let payment = await this.prisma.payment.findUniqueOrThrow({
        where: { id },
        select: internalSelect,
      });
      if (payment.provider !== this.asaas.provider)
        throw new ConflictException('Pagamento pertence a outro ambiente.');
      if (payment.status !== 'PENDING') return payment;
      if (!payment.providerPaymentId && !payment.providerRequestStartedAt) {
        if (payment.expiresAt && payment.expiresAt <= new Date()) {
          await this.prisma.payment.updateMany({
            where: { id, status: 'PENDING', providerRequestStartedAt: null },
            data: { status: 'CANCELLED' },
          });
          return this.prisma.payment.findUniqueOrThrow({
            where: { id },
            select: internalSelect,
          });
        }
        throw new ServiceUnavailableException(
          'Criação do Pix ainda não concluída. Repita a solicitação para o mesmo pedido.',
        );
      }
      let remote = payment.providerPaymentId
        ? await this.asaas.getPayment(payment.providerPaymentId)
        : await this.asaas.findPayment(payment.id);
      if (!remote)
        throw new ServiceUnavailableException(
          'Cobrança ainda não localizada no Asaas. Não crie outro pedido; aguarde a reconciliação.',
        );
      await this.acceptRemote(remote, payment.id);
      payment = await this.prisma.payment.findUniqueOrThrow({
        where: { id },
        select: internalSelect,
      });
      if (
        payment.status === 'PENDING' &&
        payment.expiresAt &&
        payment.expiresAt <= new Date() &&
        ['PENDING', 'OVERDUE'].includes(remote.status) &&
        !remote.deleted
      ) {
        await this.asaas.deletePayment(remote.id);
        // Re-read after deletion. Timeouts or payment races never release stock.
        remote = await this.asaas.getPayment(remote.id);
        await this.acceptRemote(remote, payment.id);
      }
      return this.prisma.payment.findUniqueOrThrow({
        where: { id },
        select: internalSelect,
      });
    });
  }

  private async acceptRemote(remote: AsaasPayment, expectedId?: string) {
    if (expectedId && remote.externalReference !== expectedId)
      throw new ConflictException('Referência da cobrança divergente.');
    if (!uuid.test(remote.externalReference)) return;
    const payment = await this.prisma.payment.findUnique({
      where: { id: remote.externalReference },
      select: internalSelect,
    });
    if (!payment || payment.provider !== this.asaas.provider) return;
    if (
      payment.method !== 'PIX' ||
      remote.billingType !== 'PIX' ||
      payment.providerCustomerId !== remote.customer ||
      !payment.amount.equals(remote.amount) ||
      (payment.providerPaymentId && payment.providerPaymentId !== remote.id) ||
      !payment.providerRequestStartedAt
    )
      throw new ConflictException(
        'Cobrança divergente. Necessária reconciliação com o Asaas.',
      );
    const bound = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        OR: [{ providerPaymentId: null }, { providerPaymentId: remote.id }],
      },
      data: { providerPaymentId: remote.id },
    });
    if (bound.count !== 1)
      throw new ConflictException('Cobrança alterada durante a reconciliação.');
    if (remote.status === 'RECEIVED') {
      if (!remote.paymentDate)
        throw new ConflictException('Data de pagamento ausente no Asaas.');
      await this.payments.applyVerifiedPayment({
        provider: payment.provider,
        providerPaymentId: remote.id,
        orderId: payment.orderId,
        shipmentId: payment.shipmentId,
        amount: remote.amount,
        currency: 'BRL',
        status: 'PAID',
        paidAt: new Date(`${remote.paymentDate}T00:00:00-03:00`),
      });
    } else if (
      [
        'REFUNDED',
        'REFUND_REQUESTED',
        'REFUND_IN_PROGRESS',
        'CHARGEBACK_REQUESTED',
        'CHARGEBACK_DISPUTE',
        'RECEIVED_IN_CASH',
      ].includes(remote.status)
    ) {
      throw new ConflictException(
        'Pagamento exige revisão financeira no Asaas.',
      );
    } else if (
      remote.deleted &&
      ['PENDING', 'OVERDUE'].includes(remote.status)
    ) {
      await this.payments.applyVerifiedPayment({
        provider: payment.provider,
        providerPaymentId: remote.id,
        orderId: payment.orderId,
        shipmentId: payment.shipmentId,
        amount: remote.amount,
        currency: 'BRL',
        status: 'CANCELLED',
      });
    }
    // CONFIRMED can be under precautionary Pix review. Only RECEIVED sells stock.
  }

  private async presentation(payment: Intent) {
    const pix =
      payment.status === 'PENDING' &&
      payment.providerPaymentId &&
      payment.expiresAt &&
      payment.expiresAt > new Date()
        ? await this.asaas.qrCode(payment.providerPaymentId)
        : null;
    const {
      providerPaymentId: _id,
      providerCustomerId: _customer,
      providerRequestStartedAt: _started,
      ...publicPayment
    } = payment;
    return {
      payment: toPaymentDto(publicPayment),
      pix,
      reservationExpiresAt: payment.expiresAt?.toISOString() ?? null,
    };
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: 'Serializable',
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
        throw error;
      }
    }
  }

  private async protect<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
      if (['P2034', 'P2002', 'P2025'].includes(String(code)))
        throw new ConflictException(
          'Cadastro ou pagamento alterado. Consulte os dados novamente.',
        );
      throw new ServiceUnavailableException(
        'Pagamentos temporariamente indisponíveis.',
      );
    }
  }
}
