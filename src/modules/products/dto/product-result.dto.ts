import type { Prisma } from '../../../generated/prisma/client.js';

export const productSelect = {
  id: true,
  price: true,
  observation: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  card: {
    select: {
      id: true,
      externalId: true,
      name: true,
      number: true,
      imageSmall: true,
      imageLarge: true,
      set: { select: { id: true, name: true, externalId: true } },
    },
  },
  category: { select: { id: true, name: true, slug: true, active: true } },
  condition: { select: { id: true, name: true, code: true, active: true } },
  language: { select: { id: true, name: true, code: true, active: true } },
  inventory: {
    select: {
      availableQuantity: true,
      reservedQuantity: true,
      soldQuantity: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductRecord = Prisma.ProductGetPayload<{
  select: typeof productSelect;
}>;
export function toProductDto(product: ProductRecord) {
  return {
    ...product,
    price: product.price.toFixed(2),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    inventory: product.inventory
      ? {
          ...product.inventory,
          updatedAt: product.inventory.updatedAt.toISOString(),
        }
      : null,
  };
}
