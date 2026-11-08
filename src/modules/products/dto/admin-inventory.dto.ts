import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export type InventoryStockFilter =
  'available' | 'out' | 'low' | 'reserved' | 'missing';
export interface AdminInventoryQuery {
  page: number;
  pageSize: number;
  lowStockThreshold: number;
  name?: string;
  active?: boolean;
  stock?: InventoryStockFilter;
}

function invalid(): never {
  throw new BadRequestException(
    'Filtros de estoque inválidos. Confira os dados informados.',
  );
}

@Injectable()
export class AdminInventoryPipe implements PipeTransform<
  unknown,
  AdminInventoryQuery
> {
  transform(value: unknown): AdminInventoryQuery {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          ![
            'page',
            'pageSize',
            'name',
            'active',
            'stock',
            'lowStockThreshold',
          ].includes(key),
      )
    )
      invalid();
    const integer = (key: string, fallback: number, maximum: number) => {
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
    const query: AdminInventoryQuery = {
      page: integer('page', 1, 1_000_000),
      pageSize: integer('pageSize', 20, 100),
      lowStockThreshold: integer('lowStockThreshold', 5, 2_147_483_647),
    };
    if (input.name !== undefined) {
      if (
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.length > 200
      )
        invalid();
      query.name = input.name.trim();
    }
    if (input.active !== undefined) {
      if (input.active !== 'true' && input.active !== 'false') invalid();
      query.active = input.active === 'true';
    }
    if (input.stock !== undefined) {
      if (
        typeof input.stock !== 'string' ||
        !['available', 'out', 'low', 'reserved', 'missing'].includes(
          input.stock,
        )
      )
        invalid();
      query.stock = input.stock as InventoryStockFilter;
    }
    return query;
  }
}
