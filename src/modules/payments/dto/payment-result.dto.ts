import type { Prisma } from '../../../generated/prisma/client.js';

export const paymentSelect = {
  id: true,
  orderId: true,
  shipmentId: true,
  provider: true,
  method: true,
  status: true,
  amount: true,
  installments: true,
  createdAt: true,
  updatedAt: true,
  paidAt: true,
  failedAt: true,
  expiresAt: true,
} satisfies Prisma.PaymentSelect;

export type PaymentRecord = Prisma.PaymentGetPayload<{
  select: typeof paymentSelect;
}>;

export function toPaymentDto(payment: PaymentRecord) {
  return {
    ...payment,
    amount: payment.amount.toFixed(2),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
    failedAt: payment.failedAt?.toISOString() ?? null,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
  };
}
