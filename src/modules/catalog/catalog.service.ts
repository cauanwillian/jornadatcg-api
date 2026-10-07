import {
  Injectable,
  Inject,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CatalogQuery } from './catalog-query.js';
export const visibleProducts: Prisma.ProductWhereInput = {
  active: true,
  category: { active: true },
  condition: { active: true },
  language: { active: true },
};
export const catalogSelect = {
  id: true,
  price: true,
  observation: true,
  createdAt: true,
  card: {
    select: {
      id: true,
      name: true,
      number: true,
      rarity: true,
      artist: true,
      imageSmall: true,
      imageLarge: true,
      set: { select: { id: true, name: true } },
    },
  },
  category: { select: { id: true, name: true, slug: true } },
  condition: { select: { id: true, name: true, code: true } },
  language: { select: { id: true, name: true, code: true } },
  inventory: { select: { availableQuantity: true } },
} satisfies Prisma.ProductSelect;
function dto(row: Prisma.ProductGetPayload<{ select: typeof catalogSelect }>) {
  return {
    id: row.id,
    price: row.price.toFixed(2),
    observation: row.observation,
    createdAt: row.createdAt.toISOString(),
    card: row.card,
    category: row.category,
    condition: row.condition,
    language: row.language,
    availableQuantity: row.inventory?.availableQuantity ?? 0,
    inStock: (row.inventory?.availableQuantity ?? 0) > 0,
  };
}
@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        'Catálogo temporariamente indisponível.',
      );
    }
  }
  list(q: CatalogQuery) {
    return this.safe(() =>
      this.db.$transaction(
        async (tx) => {
          const where: Prisma.ProductWhereInput = {
            ...visibleProducts,
            ...(q.categoryId ? { categoryId: q.categoryId } : {}),
            ...(q.conditionId ? { conditionId: q.conditionId } : {}),
            ...(q.languageId ? { languageId: q.languageId } : {}),
            card: {
              ...(q.name
                ? {
                    name: {
                      contains: q.name.replace(/[\\%_]/g, '\\$&'),
                      mode: 'insensitive',
                    },
                  }
                : {}),
              ...(q.rarity ? { rarity: q.rarity } : {}),
            },
            ...(q.minPrice || q.maxPrice
              ? {
                  price: {
                    ...(q.minPrice
                      ? { gte: new Prisma.Decimal(q.minPrice) }
                      : {}),
                    ...(q.maxPrice
                      ? { lte: new Prisma.Decimal(q.maxPrice) }
                      : {}),
                  },
                }
              : {}),
            ...(q.stock === 'available'
              ? { inventory: { is: { availableQuantity: { gt: 0 } } } }
              : {}),
            ...(q.stock === 'unavailable'
              ? {
                  OR: [
                    { inventory: { is: null } },
                    { inventory: { is: { availableQuantity: 0 } } },
                  ],
                }
              : {}),
          };
          const order: Prisma.ProductOrderByWithRelationInput =
            q.sort === 'price_asc'
              ? { price: 'asc' }
              : q.sort === 'price_desc'
                ? { price: 'desc' }
                : q.sort === 'oldest'
                  ? { createdAt: 'asc' }
                  : { createdAt: 'desc' };
          const total = await tx.product.count({ where });
          const rows = await tx.product.findMany({
            where,
            select: catalogSelect,
            orderBy: [order, { id: 'asc' }],
            take: q.limit,
            skip: (q.page - 1) * q.limit,
          });
          return {
            data: rows.map(dto),
            pagination: {
              page: q.page,
              limit: q.limit,
              total,
              totalPages: Math.ceil(total / q.limit),
              hasMore: q.page * q.limit < total,
            },
          };
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    );
  }
  featured() {
    return this.safe(async () => {
      const rows = await this.db.product.findMany({
        where: {
          ...visibleProducts,
          featured: true,
          inventory: { is: { availableQuantity: { gt: 0 } } },
        },
        select: catalogSelect,
        orderBy: [{ featuredOrder: 'asc' }, { id: 'asc' }],
        take: 24,
      });
      return { data: rows.map(dto) };
    });
  }
  find(id: string) {
    return this.safe(async () => {
      const row = await this.db.product.findFirst({
        where: { ...visibleProducts, id },
        select: catalogSelect,
      });
      if (!row) throw new NotFoundException('Produto não encontrado.');
      return dto(row);
    });
  }
  filters() {
    return this.safe(() =>
      this.db.$transaction(
        async (tx) => {
          const categories = await tx.category.findMany({
            where: { active: true, products: { some: visibleProducts } },
            select: { id: true, name: true, slug: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          });
          const conditions = await tx.condition.findMany({
            where: { active: true, products: { some: visibleProducts } },
            select: { id: true, name: true, code: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          });
          const languages = await tx.language.findMany({
            where: { active: true, products: { some: visibleProducts } },
            select: { id: true, name: true, code: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          });
          const cards = await tx.card.findMany({
            where: {
              rarity: { not: null },
              products: { some: visibleProducts },
            },
            select: { rarity: true },
            distinct: ['rarity'],
            orderBy: { rarity: 'asc' },
          });
          const range = await tx.product.aggregate({
            where: visibleProducts,
            _min: { price: true },
            _max: { price: true },
          });
          return {
            categories,
            conditions,
            languages,
            rarities: cards
              .map((c) => c.rarity)
              .filter((r): r is string => !!r),
            priceRange: {
              min: range._min.price?.toFixed(2) ?? null,
              max: range._max.price?.toFixed(2) ?? null,
            },
          };
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    );
  }
}
