import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { InventoryMovementType } from '../../../generated/prisma/client.js';

export interface StockMovementsQuery {
  page: number;
  pageSize: number;
  productId?: string;
  type?: InventoryMovementType;
  from?: Date;
  to?: Date;
}

function invalid(): never {
  throw new BadRequestException(
    'Filtros de movimentações inválidos. Confira os dados informados.',
  );
}

function timestamp(value: unknown): Date {
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  if (!match) invalid();
  const date = new Date(value);
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical)
    invalid();
  return date;
}

@Injectable()
export class StockMovementsPipe implements PipeTransform<
  unknown,
  StockMovementsQuery
> {
  transform(value: unknown): StockMovementsQuery {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          !['page', 'pageSize', 'productId', 'type', 'from', 'to'].includes(
            key,
          ),
      )
    )
      invalid();
    const integer = (
      key: string,
      fallback: number,
      maximum: number,
    ): number => {
      if (input[key] === undefined) return fallback;
      const raw = input[key];
      if (
        typeof raw !== 'string' ||
        !/^[1-9]\d*$/.test(raw) ||
        Number(raw) > maximum
      )
        invalid();
      return Number(raw);
    };
    const query: StockMovementsQuery = {
      page: integer('page', 1, 1_000_000),
      pageSize: integer('pageSize', 20, 100),
    };
    if (input.productId !== undefined) {
      if (
        typeof input.productId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          input.productId,
        )
      )
        invalid();
      query.productId = input.productId;
    }
    if (input.type !== undefined) {
      if (
        typeof input.type !== 'string' ||
        !Object.values(InventoryMovementType).includes(
          input.type as InventoryMovementType,
        )
      )
        invalid();
      query.type = input.type as InventoryMovementType;
    }
    if (input.from !== undefined) query.from = timestamp(input.from);
    if (input.to !== undefined) query.to = timestamp(input.to);
    if (query.from && query.to && query.from >= query.to) invalid();
    return query;
  }
}
