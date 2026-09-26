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
import {
  MAX_CART_ITEMS,
  MAX_CART_QUANTITY,
} from '../cart/dto/cart-item.dto.js';
import { cartSelect, unavailableReason } from '../cart/dto/cart-result.dto.js';
import type { CheckoutDto, OrderListQuery } from './dto/order-input.dto.js';
import { orderSelect, toOrderDto } from './dto/order-result.dto.js';
import { OrderReservationConfig } from './order-reservation.config.js';

const MAX_STOCK = 2147483647;
const MAX_AMOUNT = new Prisma.Decimal('9999999999.99');

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderReservationConfig)
    private readonly reservation: OrderReservationConfig,
  ) {}

  checkout(userId: string, checkoutKey: string, body: CheckoutDto) {
    return this.transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { userId_checkoutKey: { userId, checkoutKey } },
        select: orderSelect,
      });
      if (existing) {
        if (!existing.subtotal.equals(body.expectedSubtotal)) {
          throw new ConflictException(
            'Idempotency-Key já utilizada com outro valor.',
          );
        }
        return toOrderDto(existing);
      }
      const cart = await tx.cart.findUnique({
        where: { userId },
        select: cartSelect,
      });
      if (!cart?.items.length)
        throw new ConflictException('O carrinho está vazio.');
      if (cart.items.length > MAX_CART_ITEMS)
        throw new ConflictException('O carrinho excede o limite de produtos.');
      let subtotal = new Prisma.Decimal(0);
      for (const item of cart.items) {
        if (
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > MAX_CART_QUANTITY ||
          unavailableReason(item.product, item.quantity)
        ) {
          throw new ConflictException(
            'O carrinho contém produto indisponível ou quantidade inválida. Revise o carrinho.',
          );
        }
        subtotal = subtotal.plus(item.product.price.mul(item.quantity));
      }
      if (subtotal.greaterThan(MAX_AMOUNT))
        throw new ConflictException(
          'O valor do pedido excede o limite permitido.',
        );
      if (!subtotal.equals(body.expectedSubtotal))
        throw new ConflictException(
          'O valor do carrinho mudou. Consulte o carrinho e confirme o novo total.',
        );

      // Stable lock order reduces deadlocks between checkouts sharing products.
      const items = [...cart.items].sort((a, b) =>
        a.product.id.localeCompare(b.product.id),
      );
      for (const { product, quantity } of items) {
        const reserved = await tx.inventory.updateMany({
          where: {
            productId: product.id,
            availableQuantity: { gte: quantity },
            reservedQuantity: { lte: MAX_STOCK - quantity },
          },
          data: {
            availableQuantity: { decrement: quantity },
            reservedQuantity: { increment: quantity },
          },
        });
        if (reserved.count !== 1)
          throw new ConflictException(
            'Estoque alterado ou indisponível. Revise o carrinho.',
          );
      }
      const order = await tx.order.create({
        data: {
          userId,
          checkoutKey,
          status: 'PENDING_PAYMENT',
          expiresAt: this.reservation.deadline(),
          subtotal,
          total: subtotal,
          shippingAmount: 0,
          discountAmount: 0,
          items: {
            create: items.map(({ product, quantity }) => ({
              productId: product.id,
              cardName: product.card.name,
              cardNumber: product.card.number,
              setName: product.card.set.name,
              conditionName: product.condition.name,
              languageName: product.language.name,
              categoryName: product.category.name,
              quantity,
              unitPrice: product.price,
              totalPrice: product.price.mul(quantity),
            })),
          },
        },
        select: orderSelect,
      });
      await tx.cart.update({
        where: { id: cart.id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return toOrderDto(order);
    });
  }

  list(userId: string, query: OrderListQuery) {
    return this.transaction(async (tx) => {
      const where = {
        userId,
        ...(query.status ? { status: query.status } : {}),
      };
      const total = await tx.order.count({ where });
      const orders = await tx.order.findMany({
        where,
        select: orderSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        items: orders.map(toOrderDto),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    }, 'RepeatableRead');
  }

  get(userId: string, id: string) {
    return this.transaction(
      async (tx) => toOrderDto(await this.findOwned(tx, userId, id)),
      'RepeatableRead',
    );
  }

  cancel(userId: string, id: string) {
    return this.transaction(async (tx) => {
      const order = await this.findOwned(tx, userId, id);
      if (order.status === 'CANCELLED') return toOrderDto(order);
      if (order.status !== 'PENDING_PAYMENT')
        throw new ConflictException(
          'Somente pedidos pendentes de pagamento podem ser cancelados.',
        );
      const payment = await tx.payment.findFirst({
        where: {
          orderId: id,
          status: { in: ['PENDING', 'PAID', 'REFUNDED'] },
        },
        select: { id: true },
      });
      if (payment)
        throw new ConflictException(
          'O pedido possui um pagamento em processamento ou confirmado.',
        );
      const quantities = new Map<string, number>();
      for (const item of order.items) {
        if (
          !item.productId ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1
        ) {
          throw new ConflictException(
            'Não foi possível liberar a reserva deste pedido. Contate o suporte.',
          );
        }
        quantities.set(
          item.productId,
          (quantities.get(item.productId) ?? 0) + item.quantity,
        );
      }
      const changed = await tx.order.updateMany({
        where: { id, userId, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Pedido alterado. Consulte o pedido novamente.',
        );
      for (const [productId, quantity] of [...quantities].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        if (quantity > MAX_STOCK)
          throw new ConflictException(
            'Reserva inconsistente. Contate o suporte.',
          );
        const released = await tx.inventory.updateMany({
          where: {
            productId,
            reservedQuantity: { gte: quantity },
            availableQuantity: { lte: MAX_STOCK - quantity },
          },
          data: {
            availableQuantity: { increment: quantity },
            reservedQuantity: { decrement: quantity },
          },
        });
        if (released.count !== 1)
          throw new ConflictException(
            'Não foi possível liberar a reserva deste pedido. Contate o suporte.',
          );
      }
      return toOrderDto(await this.findOwned(tx, userId, id));
    });
  }

  private async findOwned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    const order = await tx.order.findFirst({
      where: { id, userId },
      select: orderSelect,
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    return order;
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = 'Serializable',
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel,
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
        if (['P2034', 'P2002', 'P2003', 'P2025'].includes(String(code))) {
          throw new ConflictException(
            'Os dados foram alterados. Consulte o pedido ou carrinho e tente novamente.',
          );
        }
        throw new ServiceUnavailableException(
          'Pedidos temporariamente indisponíveis.',
        );
      }
    }
    throw new ServiceUnavailableException(
      'Pedidos temporariamente indisponíveis.',
    );
  }
}
