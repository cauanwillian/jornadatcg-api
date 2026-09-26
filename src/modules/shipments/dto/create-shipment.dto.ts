import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface CreateShipmentInput {
  addressId: string;
  items: { orderItemId: string; quantity: number }[];
}
@Injectable()
export class ShipmentKeyPipe implements PipeTransform {
  transform(value: unknown): string {
    if (typeof value !== 'string' || !uuid.test(value))
      throw new BadRequestException('Idempotency-Key deve ser um UUID v4.');
    return value.toLowerCase();
  }
}
@Injectable()
export class CreateShipmentPipe implements PipeTransform {
  transform(value: unknown): CreateShipmentInput {
    const fail = (): never => {
      throw new BadRequestException(
        'Informe addressId e de 1 a 100 itens únicos com orderItemId UUID v4 e quantity inteira positiva.',
      );
    };
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return fail();
    const body = value as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['addressId', 'items'].includes(key)) ||
      typeof body.addressId !== 'string' ||
      !uuid.test(body.addressId) ||
      !Array.isArray(body.items) ||
      !body.items.length ||
      body.items.length > 100
    )
      return fail();
    const items = body.items
      .map((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return fail();
        const item = value as Record<string, unknown>;
        if (
          Object.keys(item).some(
            (key) => !['orderItemId', 'quantity'].includes(key),
          ) ||
          typeof item.orderItemId !== 'string' ||
          !uuid.test(item.orderItemId) ||
          typeof item.quantity !== 'number' ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 2147483647
        )
          return fail();
        return {
          orderItemId: item.orderItemId.toLowerCase(),
          quantity: item.quantity,
        };
      })
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
    if (new Set(items.map((item) => item.orderItemId)).size !== items.length)
      return fail();
    return { addressId: body.addressId.toLowerCase(), items };
  }
}
