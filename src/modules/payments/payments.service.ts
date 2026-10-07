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
import { moveReservedStock } from '../orders/order-stock.js';
import { paymentSelect, toPaymentDto } from './dto/payment-result.dto.js';

/** Internal contract: only a provider adapter that verified the payment may call it. */
export interface VerifiedPayment {
  provider: string;
  providerPaymentId: string;
  orderId: string | null;
  shipmentId?: string | null;
  amount: string;
  currency: 'BRL';
  status: 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  paidAt?: Date;
}

@Injectable()
export class PaymentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(userId: string, orderId: string) {
    return this.transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Pedido não encontrado.');
      const payments = await tx.payment.findMany({
        where: { orderId },
        select: paymentSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return payments.map(toPaymentDto);
    });
  }

  // Deliberately not exposed as an HTTP endpoint. Browser redirects and client
  // requests are never proof of payment. The adapter must verify remotely.
  applyVerifiedPayment(event: VerifiedPayment) {
    if (
      event.currency !== 'BRL' ||
      !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(event.amount) ||
      event.amount === '0.00' ||
      !['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(event.status) ||
      !event.provider ||
      !event.providerPaymentId ||
      (event.status === 'PAID' &&
        (!(event.paidAt instanceof Date) ||
          !Number.isFinite(event.paidAt.getTime()) ||
          event.paidAt.getTime() > Date.now() + 60_000))
    ) {
      throw new ConflictException('Dados de pagamento inconsistentes.');
    }
    return this.transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { providerPaymentId: event.providerPaymentId },
        select: {
          ...paymentSelect,
          order: {
            select: {
              id: true,
              status: true,
              total: true,
              items: { select: { productId: true, quantity: true } },
            },
          },
          shipment: {
            select: {
              id: true,
              status: true,
              shippingCost: true,
              shippingPaidAt: true,
            },
          },
        },
      });
      if (
        !payment ||
        payment.provider !== event.provider ||
        payment.orderId !== event.orderId ||
        (payment.shipmentId ?? null) !== (event.shipmentId ?? null)
      ) {
        throw new NotFoundException('Pagamento não encontrado.');
      }
      const { order, shipment, ...record } = payment;
      if (payment.shipmentId) {
        if (
          !shipment ||
          !payment.amount.equals(event.amount) ||
          !shipment.shippingCost.equals(event.amount)
        )
          throw new ConflictException(
            'Valor do pagamento não corresponde ao frete.',
          );
        if (payment.status === 'PAID' || payment.status === 'REFUNDED')
          return toPaymentDto(record);
        if (payment.status !== 'PENDING') {
          if (event.status === 'PAID')
            throw new ConflictException(
              'Frete pago após encerramento. Necessária revisão financeira.',
            );
          return toPaymentDto(record);
        }
        if (event.status === 'PAID') {
          const other = await tx.payment.findFirst({
            where: {
              shipmentId: shipment.id,
              id: { not: payment.id },
              status: { in: ['PAID', 'REFUNDED'] },
            },
          });
          if (other)
            throw new ConflictException(
              'Frete já possui pagamento confirmado.',
            );
          const changed = await tx.shipment.updateMany({
            where: { id: shipment.id, status: 'PENDING', shippingPaidAt: null },
            data: { status: 'PREPARING', shippingPaidAt: event.paidAt },
          });
          if (changed.count !== 1)
            throw new ConflictException(
              'Envio encerrado ou alterado. Necessária revisão financeira.',
            );
        }
        const changed = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: {
            status: event.status,
            ...(event.status === 'PAID'
              ? { paidAt: event.paidAt }
              : event.status === 'FAILED'
                ? { failedAt: new Date() }
                : {}),
          },
        });
        if (changed.count !== 1)
          throw new ConflictException('Pagamento de frete alterado.');
        // Freight settlement never changes purchase payments or inventory.
        return toPaymentDto(
          await tx.payment.findUniqueOrThrow({
            where: { id: payment.id },
            select: paymentSelect,
          }),
        );
      }
      if (!order)
        throw new ConflictException('Pedido do pagamento não encontrado.');
      if (
        !payment.amount.equals(event.amount) ||
        !order.total.equals(event.amount)
      ) {
        throw new ConflictException(
          'Valor do pagamento não corresponde ao pedido.',
        );
      }
      // Replays and stale failure notifications must never undo a paid purchase.
      if (payment.status === 'PAID' || payment.status === 'REFUNDED')
        return toPaymentDto(record);
      if (payment.status !== 'PENDING') {
        if (event.status === 'PAID')
          throw new ConflictException(
            'Pagamento aprovado após encerramento. Necessária reconciliação com o provedor.',
          );
        return toPaymentDto(record);
      }
      if (event.status === 'PAID') {
        if (order.status !== 'PENDING_PAYMENT')
          throw new ConflictException(
            'Pedido encerrado. Necessária reconciliação com o provedor.',
          );
        const otherPaid = await tx.payment.findFirst({
          where: {
            orderId: order.id,
            id: { not: payment.id },
            status: { in: ['PAID', 'REFUNDED'] },
          },
          select: { id: true },
        });
        if (otherPaid)
          throw new ConflictException(
            'O pedido já possui outro pagamento confirmado.',
          );
        const changed = await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING_PAYMENT' },
          data: { status: 'PAID', paidAt: event.paidAt },
        });
        if (changed.count !== 1)
          throw new ConflictException('Pedido alterado durante a confirmação.');
        await moveReservedStock(tx, order.items, 'soldQuantity');
      }
      const changed = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status: event.status,
          ...(event.status === 'PAID'
            ? { paidAt: event.paidAt }
            : event.status === 'FAILED'
              ? { failedAt: new Date() }
              : {}),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Pagamento alterado durante a atualização.',
        );
      if (event.status !== 'PAID' && order.status === 'PENDING_PAYMENT') {
        const active = await tx.payment.findFirst({
          where: {
            orderId: order.id,
            status: { in: ['PENDING', 'PAID', 'REFUNDED'] },
          },
          select: { id: true },
        });
        if (!active) {
          const cancelled = await tx.order.updateMany({
            where: { id: order.id, status: 'PENDING_PAYMENT' },
            data: { status: 'CANCELLED', cancelledAt: new Date() },
          });
          if (cancelled.count !== 1)
            throw new ConflictException(
              'Pedido alterado durante o cancelamento.',
            );
          await moveReservedStock(tx, order.items, 'availableQuantity');
        }
      }
      const updated = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: paymentSelect,
      });
      return toPaymentDto(updated);
    });
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: 'Serializable',
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if (code === 'P2034' && attempt < 2) continue;
        if (['P2034', 'P2002', 'P2003', 'P2025'].includes(String(code)))
          throw new ConflictException(
            'Pagamento alterado. Consulte os dados novamente.',
          );
        throw new ServiceUnavailableException(
          'Pagamentos temporariamente indisponíveis.',
        );
      }
    }
    throw new ServiceUnavailableException(
      'Pagamentos temporariamente indisponíveis.',
    );
  }
}
