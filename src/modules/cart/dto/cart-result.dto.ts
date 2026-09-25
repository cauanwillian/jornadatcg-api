import { Prisma } from '../../../generated/prisma/client.js';

export const cartProductSelect = {
  id: true,
  price: true,
  active: true,
  card: {
    select: {
      id: true,
      name: true,
      number: true,
      imageSmall: true,
      imageLarge: true,
      set: { select: { id: true, name: true } },
    },
  },
  category: { select: { id: true, name: true, active: true } },
  condition: { select: { id: true, name: true, code: true, active: true } },
  language: { select: { id: true, name: true, code: true, active: true } },
  inventory: { select: { availableQuantity: true } },
} satisfies Prisma.ProductSelect;

export const cartSelect = {
  id: true,
  updatedAt: true,
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      quantity: true,
      product: { select: cartProductSelect },
    },
  },
} satisfies Prisma.CartSelect;

export type CartProduct = Prisma.ProductGetPayload<{
  select: typeof cartProductSelect;
}>;
export type CartRecord = Prisma.CartGetPayload<{ select: typeof cartSelect }>;

export function unavailableReason(
  product: CartProduct,
  quantity: number,
): string | null {
  if (!product.active) return 'PRODUCT_INACTIVE';
  if (
    !product.category.active ||
    !product.condition.active ||
    !product.language.active
  )
    return 'OPTION_INACTIVE';
  if (!product.price.greaterThan(0)) return 'INVALID_PRICE';
  if (!product.inventory || product.inventory.availableQuantity <= 0)
    return 'OUT_OF_STOCK';
  if (quantity > product.inventory.availableQuantity)
    return 'INSUFFICIENT_STOCK';
  return null;
}

export function toCartDto(cart: CartRecord | null) {
  const items = (cart?.items ?? []).map((item) => {
    const product = item.product;
    const reason = unavailableReason(product, item.quantity);
    return {
      id: item.id,
      productId: product.id,
      quantity: item.quantity,
      unitPrice: product.price.toFixed(2),
      subtotal: product.price.mul(item.quantity).toFixed(2),
      available: reason === null,
      unavailableReason: reason,
      availableQuantity: product.inventory?.availableQuantity ?? 0,
      card: product.card,
      category: { id: product.category.id, name: product.category.name },
      condition: {
        id: product.condition.id,
        name: product.condition.name,
        code: product.condition.code,
      },
      language: {
        id: product.language.id,
        name: product.language.name,
        code: product.language.code,
      },
    };
  });
  return {
    id: cart?.id ?? null,
    updatedAt: cart?.updatedAt.toISOString() ?? null,
    items,
    summary: {
      itemCount: items.length,
      totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
      subtotal: items
        .reduce(
          (total, item) => total.plus(item.subtotal),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
      allItemsAvailable:
        items.length > 0 && items.every((item) => item.available),
    },
  };
}
