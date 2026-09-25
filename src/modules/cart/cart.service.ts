import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  cartProductSelect,
  cartSelect,
  toCartDto,
  unavailableReason,
} from './dto/cart-result.dto.js';
import { MAX_CART_ITEMS } from './dto/cart-item.dto.js';

@Injectable()
export class CartService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get(userId: string) {
    return this.transaction((tx) => this.read(tx, userId), 'RepeatableRead');
  }

  setItem(userId: string, productId: string, quantity: number) {
    return this.transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: cartProductSelect,
      });
      if (!product) throw new NotFoundException('Produto não encontrado.');
      if (unavailableReason(product, quantity))
        throw new ConflictException(
          'Produto indisponível ou quantidade superior ao estoque disponível.',
        );
      const cart = await tx.cart.upsert({
        where: { userId },
        update: { updatedAt: new Date() },
        create: { userId },
        select: { id: true },
      });
      const where = { cartId_productId: { cartId: cart.id, productId } };
      const existing = await tx.cartItem.findUnique({
        where,
        select: { id: true },
      });
      if (
        !existing &&
        (await tx.cartItem.count({ where: { cartId: cart.id } })) >=
          MAX_CART_ITEMS
      ) {
        throw new ConflictException(
          `O carrinho aceita até ${MAX_CART_ITEMS} produtos distintos.`,
        );
      }
      // Absolute quantity makes a repeated PUT safe: it never adds duplicate units.
      await tx.cartItem.upsert({
        where,
        create: { cartId: cart.id, productId, quantity },
        update: { quantity },
        select: { id: true },
      });
      return this.read(tx, userId);
    });
  }

  removeItem(userId: string, productId: string) {
    return this.remove(userId, productId);
  }

  clear(userId: string) {
    return this.remove(userId);
  }

  private remove(userId: string, productId?: string) {
    return this.transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!cart) return toCartDto(null);
      await tx.cart.update({
        where: { id: cart.id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id, ...(productId ? { productId } : {}) },
      });
      return this.read(tx, userId);
    });
  }

  private async read(tx: Prisma.TransactionClient, userId: string) {
    return toCartDto(
      await tx.cart.findUnique({ where: { userId }, select: cartSelect }),
    );
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
          timeout: 5000,
        });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
        if (
          code === 'P2034' ||
          code === 'P2002' ||
          code === 'P2003' ||
          code === 'P2025'
        ) {
          throw new ConflictException(
            'O carrinho ou produto foi alterado. Consulte os dados e tente novamente.',
          );
        }
        throw new ServiceUnavailableException(
          'Carrinho temporariamente indisponível.',
        );
      }
    }
    throw new ServiceUnavailableException(
      'Carrinho temporariamente indisponível.',
    );
  }
}
