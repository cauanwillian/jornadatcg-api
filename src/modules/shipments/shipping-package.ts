import { BadRequestException } from '@nestjs/common';

export function shippingPackage(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 70)
    throw new BadRequestException(
      'Cada envio deve conter de 1 a 70 cartas. Divida quantidades maiores em solicitações separadas.',
    );
  return quantity <= 30
    ? { name: 'Pequena', height: 3, width: 12, length: 17, weight: 0.15 }
    : { name: 'Média', height: 5, width: 10, length: 15, weight: 0.15 };
}
export type ShippingPackage = ReturnType<typeof shippingPackage>;
