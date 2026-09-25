import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export const MAX_CART_QUANTITY = 999;
export const MAX_CART_ITEMS = 100;
export interface SetCartItemDto {
  quantity: number;
}

@Injectable()
export class SetCartItemPipe implements PipeTransform<unknown, SetCartItemDto> {
  transform(value: unknown): SetCartItemDto {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'quantity')
    ) {
      throw new BadRequestException('Envie somente quantity.');
    }
    const quantity = (value as Record<string, unknown>).quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_CART_QUANTITY
    ) {
      throw new BadRequestException(
        `quantity deve ser um inteiro entre 1 e ${MAX_CART_QUANTITY}. Use DELETE para remover o item.`,
      );
    }
    return { quantity };
  }
}
