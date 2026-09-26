import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
export interface AvailableItemsQuery {
  page: number;
  pageSize: number;
}
@Injectable()
export class AvailableItemsPipe implements PipeTransform<
  unknown,
  AvailableItemsQuery
> {
  transform(value: unknown): AvailableItemsQuery {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !['page', 'pageSize'].includes(key))
    )
      throw new BadRequestException('Use somente page e pageSize.');
    const query = value as Record<string, unknown>;
    const integer = (key: string, fallback: number, max: number) => {
      const raw = query[key];
      if (raw === undefined) return fallback;
      if (
        typeof raw !== 'string' ||
        !/^[1-9]\d*$/.test(raw) ||
        Number(raw) > max
      )
        throw new BadRequestException(
          `${key} deve ser um inteiro entre 1 e ${max}.`,
        );
      return Number(raw);
    };
    return {
      page: integer('page', 1, 1000000),
      pageSize: integer('pageSize', 20, 100),
    };
  }
}
