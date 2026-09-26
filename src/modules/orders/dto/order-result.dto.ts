import type { Prisma } from '../../../generated/prisma/client.js';

export const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  subtotal: true,
  shippingAmount: true,
  discountAmount: true,
  total: true,
  createdAt: true,
  updatedAt: true,
  paidAt: true,
  expiresAt: true,
  cancelledAt: true,
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      productId: true,
      cardName: true,
      cardNumber: true,
      setName: true,
      conditionName: true,
      languageName: true,
      categoryName: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{
  select: typeof orderSelect;
}>;

export function toOrderDto(order: OrderRecord) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    subtotal: order.subtotal.toFixed(2),
    shippingAmount: order.shippingAmount.toFixed(2),
    discountAmount: order.discountAmount.toFixed(2),
    total: order.total.toFixed(2),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    items: order.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toFixed(2),
      totalPrice: item.totalPrice.toFixed(2),
    })),
  };
}
