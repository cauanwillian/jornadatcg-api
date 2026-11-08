import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { OrderStatus } from '../../../generated/prisma/client.js';

export interface AdminOrderListQuery {
  page: number;
  pageSize: number;
  status?: OrderStatus;
  orderNumber?: number;
  customer?: string;
  from?: Date;
  to?: Date;
}

function invalid(): never {
  throw new BadRequestException(
    'Filtros de pedidos inválidos. Confira os dados informados.',
  );
}

function timestamp(value: unknown): Date {
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  if (!match) invalid();
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical)
    invalid();
  return date;
}

@Injectable()
export class AdminOrderListPipe implements PipeTransform<
  unknown,
  AdminOrderListQuery
> {
  transform(value: unknown): AdminOrderListQuery {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          ![
            'page',
            'pageSize',
            'status',
            'orderNumber',
            'customer',
            'from',
            'to',
          ].includes(key),
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
    const result: AdminOrderListQuery = {
      page: integer('page', 1, 1_000_000),
      pageSize: integer('pageSize', 20, 100),
    };
    if (input.status !== undefined) {
      if (
        typeof input.status !== 'string' ||
        !Object.values(OrderStatus).includes(input.status as OrderStatus)
      )
        invalid();
      result.status = input.status as OrderStatus;
    }
    if (input.orderNumber !== undefined)
      result.orderNumber = integer('orderNumber', 1, 2_147_483_647);
    if (input.customer !== undefined) {
      if (
        typeof input.customer !== 'string' ||
        !input.customer.trim() ||
        input.customer.length > 200
      )
        invalid();
      result.customer = input.customer.trim();
    }
    if (input.from !== undefined) result.from = timestamp(input.from);
    if (input.to !== undefined) result.to = timestamp(input.to);
    if (result.from && result.to && result.from >= result.to) invalid();
    return result;
  }
}
