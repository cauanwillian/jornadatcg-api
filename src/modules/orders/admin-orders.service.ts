import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AdminOrderListQuery } from './dto/admin-order-input.dto.js';
import { orderSelect, toOrderDto } from './dto/order-result.dto.js';
import {
  paymentSelect,
  toPaymentDto,
} from '../payments/dto/payment-result.dto.js';

const customerSelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;
const listSelect = {
  id: true,
  orderNumber: true,
  status: true,
  total: true,
  createdAt: true,
  paidAt: true,
  cancelledAt: true,
  user: { select: customerSelect },
  items: { select: { quantity: true } },
} satisfies Prisma.OrderSelect;

function filters(query: AdminOrderListQuery): Prisma.OrderWhereInput {
  const customer = query.customer?.replace(/[\\%_]/g, '\\$&');
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.orderNumber === undefined
      ? {}
      : { orderNumber: query.orderNumber }),
    ...(customer
      ? {
          user: {
            OR: [
              { name: { contains: customer, mode: 'insensitive' } },
              { email: { contains: customer, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lt: query.to } : {}),
          },
        }
      : {}),
  };
}

@Injectable()
export class AdminOrdersService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  list(query: AdminOrderListQuery) {
    return this.read(async (tx) => {
      const where = filters(query);
      const confirmedWhere: Prisma.OrderWhereInput = {
        AND: [
          where,
          {
            status: {
              in: [
                'PAID',
                'PREPARING',
                'READY_TO_SHIP',
                'SHIPPED',
                'DELIVERED',
              ],
            },
            paidAt: { not: null },
            payments: {
              some: { status: 'PAID' },
              none: { status: 'REFUNDED' },
            },
          },
        ],
      };
      const [total, pendingCount, confirmed, orders] = await Promise.all([
        tx.order.count({ where }),
        tx.order.count({
          where: { AND: [where, { status: 'PENDING_PAYMENT' }] },
        }),
        tx.order.aggregate({
          where: confirmedWhere,
          _count: { _all: true },
          _sum: { subtotal: true, discountAmount: true },
        }),
        tx.order.findMany({
          where,
          select: listSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return {
        items: orders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: order.total.toFixed(2),
          createdAt: order.createdAt.toISOString(),
          paidAt: order.paidAt?.toISOString() ?? null,
          cancelledAt: order.cancelledAt?.toISOString() ?? null,
          customer: {
            id: order.user.id,
            name: order.user.name,
            email: order.user.email,
          },
          quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
        summary: {
          orderCount: total,
          pendingCount,
          confirmedCount: confirmed._count._all,
          confirmedAmount: (confirmed._sum.subtotal ?? new Prisma.Decimal(0))
            .minus(confirmed._sum.discountAmount ?? new Prisma.Decimal(0))
            .toFixed(2),
        },
      };
    });
  }

  detail(id: string) {
    return this.read(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          ...orderSelect,
          userId: true,
          user: { select: customerSelect },
          payments: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: paymentSelect,
          },
        },
      });
      if (!order) throw new NotFoundException('Pedido não encontrado.');
      const shipments = await tx.shipment.findMany({
        where: {
          userId: order.userId,
          items: { some: { orderItem: { orderId: id } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          createdAt: true,
          shippedAt: true,
          deliveredAt: true,
          trackingCode: true,
          shippingCost: true,
          shippingPaidAt: true,
          items: {
            where: { orderItem: { orderId: id } },
            select: { orderItemId: true, quantity: true },
            orderBy: [{ orderItemId: 'asc' }],
          },
        },
      });
      const canonical = toOrderDto(order);
      return {
        order: {
          ...canonical,
          items: canonical.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            cardName: item.cardName,
            cardNumber: item.cardNumber,
            setName: item.setName,
            conditionName: item.conditionName,
            languageName: item.languageName,
            categoryName: item.categoryName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          })),
        },
        customer: {
          id: order.user.id,
          name: order.user.name,
          email: order.user.email,
        },
        payments: order.payments.map((payment) =>
          toPaymentDto({
            id: payment.id,
            orderId: payment.orderId,
            shipmentId: payment.shipmentId,
            provider: payment.provider,
            method: payment.method,
            status: payment.status,
            amount: payment.amount,
            installments: payment.installments,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
            paidAt: payment.paidAt,
            failedAt: payment.failedAt,
            expiresAt: payment.expiresAt,
          }),
        ),
        shipments: shipments.map((shipment) => ({
          id: shipment.id,
          status: shipment.status,
          requestedAt: shipment.createdAt.toISOString(),
          shippedAt: shipment.shippedAt?.toISOString() ?? null,
          deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
          trackingCode: shipment.trackingCode,
          shippingCost: shipment.shippingCost.toFixed(2),
          shippingPaidAt: shipment.shippingPaidAt?.toISOString() ?? null,
          items: shipment.items.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
          })),
        })),
      };
    });
  }

  private async read<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.$transaction(work, {
        isolationLevel: 'RepeatableRead',
        maxWait: 5000,
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Pedidos administrativos temporariamente indisponíveis.',
      );
    }
  }
}
