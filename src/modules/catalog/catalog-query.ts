import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
export interface CatalogQuery {
  page: number;
  limit: number;
  name?: string;
  categoryId?: string;
  conditionId?: string;
  languageId?: string;
  rarity?: string;
  minPrice?: string;
  maxPrice?: string;
  stock?: 'available' | 'unavailable';
  sort: 'price_asc' | 'price_desc' | 'newest' | 'oldest';
}
@Injectable()
export class CatalogQueryPipe implements PipeTransform {
  transform(value: Record<string, unknown>): CatalogQuery {
    const allowed = [
      'page',
      'limit',
      'name',
      'categoryId',
      'conditionId',
      'languageId',
      'rarity',
      'minPrice',
      'maxPrice',
      'stock',
      'sort',
    ];
    if (
      Object.keys(value).some((k) => !allowed.includes(k)) ||
      Object.values(value).some((v) => typeof v !== 'string')
    )
      throw new BadRequestException('Parâmetros de catálogo inválidos.');
    const q = value as Record<string, string>;
    const integer = (key: string, fallback: number, max: number) => {
      if (q[key] === undefined) return fallback;
      if (!/^[1-9]\d*$/.test(q[key]) || Number(q[key]) > max)
        throw new BadRequestException(`${key} inválido.`);
      return Number(q[key]);
    };
    const result: CatalogQuery = {
      page: integer('page', 1, 10000),
      limit: integer('limit', 24, 100),
      sort: 'newest',
    };
    for (const key of ['name', 'rarity'] as const)
      if (q[key] !== undefined) {
        const s = q[key].trim();
        if (!s || s.length > 120)
          throw new BadRequestException(`${key} inválido.`);
        result[key] = s;
      }
    for (const key of ['categoryId', 'conditionId', 'languageId'] as const)
      if (q[key] !== undefined) {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            q[key],
          )
        )
          throw new BadRequestException(`${key} inválido.`);
        result[key] = q[key];
      }
    for (const key of ['minPrice', 'maxPrice'] as const)
      if (q[key] !== undefined) {
        if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(q[key]))
          throw new BadRequestException(`${key} inválido.`);
        result[key] = q[key];
      }
    if (
      result.minPrice &&
      result.maxPrice &&
      new Prisma.Decimal(result.minPrice).gt(result.maxPrice)
    )
      throw new BadRequestException(
        'minPrice deve ser menor ou igual a maxPrice.',
      );
    if (q.stock !== undefined) {
      if (!['available', 'unavailable'].includes(q.stock))
        throw new BadRequestException('stock inválido.');
      result.stock = q.stock as CatalogQuery['stock'];
    }
    if (q.sort !== undefined) {
      if (!['price_asc', 'price_desc', 'newest', 'oldest'].includes(q.sort))
        throw new BadRequestException('sort inválido.');
      result.sort = q.sort as CatalogQuery['sort'];
    }
    return result;
  }
}
